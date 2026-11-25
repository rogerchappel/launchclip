# R&D: a per-frame character rig

Status: shipped as an opt-in path (`cast.rig: "frame"`, §9), approved by
the owner ("definitely better"). HyperFrames parity passes on both rig
fixtures and both rig example stories. Not yet the default (§7 step 4).
Date: 2026-11-25
Code: `kit/core/characters/rig-frame.mjs` (the rig),
`kit/core/characters/rig-frame-draw.mjs` (the drawing per style),
`kit/core/characters/rig-scene.mjs` (the scene contract both renderers draw,
and the prototype scene), `kit/core/characters/rig-compile.mjs` (cast-scene
cues to a plan), `kit/core/characters/rig-scene-layer.mjs` and
`kit/hyperframes/rig-runtime.mjs` (the renderers' per-frame layer),
`kit/core/characters/rig-metrics.mjs` and `src/rig_gate.js` (the rig gate),
`eval/per-frame-rig/` (today's storyboard, the side-by-side render, the
metrics, a quick preview, the cost), `test/rig_*.test.js`.
Opt-in with `cast.rig: "frame"`; without it, today's rig output (op lists,
goldens, parity) is unchanged.

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
rigFrame(character, track, t, {plan, checkpoints, grip}?) → {joints, legs, arms, lean, bend, head, look, hbob, squash, stepSquash, carry, walk}
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
  `stick` draws each limb as two straight segments with the style's ink edge
  round the colour of what covers it (sleeves, trousers, skin), round hands
  and line feet; `stick-classic` the same in one ink line with a paper head.
  Both use the style's own head (`stickHead`, split out of `drawStick` with
  byte-identical output). `RIG_FRAME_STYLES` is exactly these three; every
  other style keeps today's rig (their limbs are shaded capsules, so a
  per-frame curve buys them little), and `validateRigScenePlan` refuses them.

### 2.1 Production additions

- **The scene contract.** `rig-scene.mjs` draws a whole scene from one JSON
  plan (`launchclip.rig-scene.v1`, documented at the top of the file):
  `rigSceneTree(plan, t, {width, height}, prepared?)` → one `el()` SVG tree
  in canvas px, transparent; `rigScenePrepare(plan)` → the JSON-serialisable
  shared work; `rigSceneState` → the joints and prop places the tree is drawn
  from (for gates); `validateRigScenePlan` → errors. Both renderers draw the
  same tree, so parity is by construction.
- **Checkpoints.** `springCheckpoints` stores the springs' state every 120
  sub-steps (0.5 s); `rigFrame` resumes from the nearest one and runs the
  same fixed sub-steps, so the floats are identical to a replay from 0 (the
  test compares whole frames with `deepStrictEqual`, also after a JSON round
  trip of the checkpoints). A frame now costs the same at any t.
- **Turns.** `facings: [{t, facing}]` turn the figure over `TURN` (0.26 s):
  the facing used for limbs flips halfway, the lean, shift and head turn
  ease through 0 (the head passes through front), shoes and gloves flip with
  it, and the elbow limit relaxes so the arms swing round on their springs.
  A walk the other way turns first on its own (a facing key 0.6 × TURN
  before it starts). Walks are planned in world x for either direction.
- **Head and body agree.** The head turns three-quarter toward the facing
  (the toon `gaze` and `turn` joints at `GAZE.quarter`, narrowed by
  `quarterScale`) by a sprung `look` channel: 1 while walking, 0.8 while a
  hand acts on a path, 0 standing still (front, a small look toward the
  facing). Keys can set `look` directly. We chose a three-quarter head over a
  three-quarter body: our faces read well turned, the profile body keeps the
  walk legible, and the reference clips walk exactly so.
- **Bouncier walk.** Steps of 230, lift 96 peaking early (a high, quick
  knee), bob 30, arm swing 30° with the elbow flexing on the forward swing,
  lean 7°. The upper body moves: the shoulders roll with the stride, the
  head nods into each step on its (lagging) spring and trails the bob on its
  own under-damped spring (`hbob`), and the upper body squashes on each
  contact and stretches a little through passing (`stepSquash`, full on
  rubber-hose, 0.4 of it on the sticks). Moving holds: breath, arm sway, a
  slow weight shift and a head drift, all pure functions of t.
- **Props in hand.** A one-hand prop sits in its hand at its grip and the
  arm carries it forward (a sprung pose, the swing mostly gone). A two-hand
  prop (box, paper-stack) is carried before the chest; both wrists lock on
  its sides by IK after the springs, so the arms follow it through the walk.
  `hands[side][k].grip` locks a hand on a prop's grip for a run of keys (a
  pick-up, a catch, the receiving side of a handover); it blends in and out
  over `handBlend`. A prop in the far hand is drawn behind the body.
- **Props between hands.** Prop paths mix `{t, at}` (canvas px) and
  `{t, holder}`: held between keys with the same holder, passed between two
  holders, and along a smooth run of `at` keys that starts at the hand it
  left (the release point) and ends in the hand that takes it (both found
  in `prepare`). Two equal neighbours hold, so a box can rest until picked
  up. A prop's own `squash` flattens it about its bottom.
- **Feet paths.** `feet: {l|r: [{t, at, bend?}]}` (hip-relative) move a foot
  by IK for a kick or a stomp; the pelvis stops lowering for that foot while
  it is off the ground, and the foot's place is kept, so it lands where it
  stood.
- **Gag squash.** `squash: [{t, amount, hold, recover}]` scales the drawing
  about the feet (area kept); the bones are untouched, so every rig
  guarantee holds. It arrives over a 50 ms attack, so it never pops.
- **Speech.** `mouth: [{t, viseme}]` opens the static face's mouth at the
  viseme's size (`VISEMES`, as today's speech); `toon.mjs` draws it only
  when asked, so today's faces are unchanged.
- **Seated sets are out of scope.** `track.sit` is refused; the compiler
  keeps today's rig for seated sets.

## 3. The prototype

One rubber-hose `oliver`, 9:16, 8 s, on the `standing` set. Walk left about
0.6 m with the ball in his right hand (0.3–1.75 s), stop with a small gag
squash, turn to face right (2.3 s), anticipation (crouch, lean back, weight
to the back foot, the arm drops from the carry, swings back and cocks behind
the head), an over-the-top throw released at 4.47 s, follow-through, settle,
then an idle: breath, arm sway and a weight shift front to back.
`prototypePlan()` (rig-scene.mjs) builds it as a rig-scene plan; the ball's
flight is sampled from the release point every 0.1 s.

The first prototype threw left from 260 px: the follow-through carried the
hand and glove past the left edge of its own canvas, which the side-by-side
showed as an arm drawn as a bare line for several frames (the "missing
glove"). The rig drew the glove; the scene put it off the canvas. The scene
now ends its walk at 363 px and throws toward the open side.

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
| foot slide while on the ground, walk (px) | 575.5 | 7.9 |
| joint jerk, RMS (deg/s³) | 208166 | 136472 |
| joint jerk per unit of motion (1/s²) | 1111 | 1107 |
| throw: hand travel (px) | 1600.5 | 1859.4 |
| throw: hand path bow (sagitta / span) | 0.41 | 0.53 |
| throw: worst turn between frames (deg) | 131.8 | 114.2 |
| throw: corners (> 45° turn in a frame) | 5 | 3 |
| frames with legs crossing | 0 | 12 |
| frames with arms crossing (arm/arm, arm/leg) | 2, 0 | 74, 1 |
| bone length drift (px) | 1.3 | 0 |

(Re-measured on the production scene: 0.6 m walk carrying the ball, a turn,
a throw to the right. The first prototype measured 12.9 px slide and jerk
60420 / 665; the production walk is twice as bouncy and the turn and carry
add motion, so jerk rises while jerk per unit of motion matches today's.
The arms cross 74 frames because the ball arm carries across the body in
profile: correct in a side view.)

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

Cost (`node eval/per-frame-rig/perf.mjs`, the production rig): replaying
the springs from 0 averages 2.7 ms a frame (5.0 ms in the last second);
from the checkpoints 0.17 ms at any t. The whole scene tree, drawing
included, is 0.3 ms a frame. `rigScenePrepare` takes 10 ms and its JSON is
10 KB for the 8 s prototype (about 1.3 KB per actor-second).

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

1. The page inlines the plan and `rigScenePrepare(plan)` (JSON), so the
   browser never replays the springs from 0.
2. A runtime carries `rigSceneTree` and what it imports, made
   self-contained like `PARTICLE_RUNTIME`.
3. A proxy tween's `onUpdate` calls `rigSceneTree(plan, clock.t, canvas,
   prepared)` and puts the tree in the host. Remotion renders the same tree
   from the same function.

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

- **Cost grows with time.** Fixed: checkpoints every 0.5 s in `prepared`;
  a frame resumes from the nearest one with bit-identical floats.
- **Floating-point drift between engines.** Node, Chromium (Remotion) and
  Chromium (HyperFrames) share V8, so the same code gives the same floats.
  The `r1` rounding of path data absorbs the rest. A parity test guards it.
- **Authoring.** Hand paths and body keys are hand-written in the
  prototype. Planners can't write them. They must come from the cues we
  already have (`throw`, `point-at`, `catch`, `walk-to`), as generated
  breakdowns per action.
- **Front view vs profile.** The body walks and acts in profile with a
  three-quarter head; standing still the head comes to front. A full turn to
  camera (a front-view body) and sitting are not designed: seated sets keep
  today's rig.
- **What today does that this doesn't.** Contact reactions beyond squash
  (stagger), gaze at a target, paper-stack sheets that lag, skirts on the
  stick figures, and the toon styles. Expressions, visemes, carries,
  handovers, throws, kicks and squash are in.

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

The production pass (§2.1) closed the first gaps against the reference:
bigger, bouncier steps, a shoulder roll, a lagging head bob and nod, body
squash on contact, gag squash, carries and a head that agrees with the body.
Still missing: the limbs themselves don't squash or stretch (bones are
rigid on purpose), hand shapes don't change with the action, and the cue
compiler (cues → tracks) is separate work.

## 9. What shipped (2026-11-25)

Opt-in with `story.cast.rig: "frame"` or a cast-scene's `params.rig`
(docs/KIT_CONTRACTS.md). One code path: the cue compiler
(`rig-compile.mjs`) writes a `launchclip.rig-scene.v1` plan, the cast
scene's view holds one empty `<scene>-rig` layer, Remotion fills it from
`rigSceneTree` with a memoised `prepared`, HyperFrames from a proxy tween
calling the inlined `RIG_RUNTIME` (about 90 KB, was 118 KB with the
prototype's cast code) with `prepared` as JSON, and the rig gate measures
`rigSceneState`, the same joints and prop places.

Fixes made while wiring it up:

- **Props follow the rig's semantics.** A holder key where a hand takes a
  prop and another where it lets go (without the second, a prop slid from
  the grip to the release); a handover passes from the giver's key at the
  receiver's grip to the receiver's at the release (it had passed over the
  whole carry); two equal keys rest a prop until just before a pick-up (it
  had crept toward the hand from the scene start); a flight leaves its
  first and last 0.1 s to the rig's curve, and a throw caught hand to hand
  keeps only the flight's top. A carry's leftover tween in the op list that
  jumped a dropped box back up is ignored.
- **Pick-ups land in the hand.** Grip keys reach for where the prop rests
  until the take; a grip lock puts the palm, not the wrist, on the point; a
  two-hand prop sits between the palms and its carry comes in after the
  take; a lift takes the prop when its hold at the bottom ends, once the
  sprung body has crouched. Grip loss on the box story's coin went from
  48 px to under 4.
- **Shared people.** A character shared with the neighbouring scene is
  hidden until the way in (`actors[].visible`), as the op list does.
- **The gate** reads `rigSceneState`; grip loss is a pick-up from rest the
  hand never reached (a throw, catch or handover is continuous by
  construction). Warning guides recalibrated on the production prototype;
  error limits unchanged.

Measured:

| check | stickman-box-rig (rubber-hose, 2 scenes) | stickman-void-rig (stick-classic) |
|---|---|---|
| rig gate | passed, 0 errors, 3 warnings (hand corners, jerk 1548/s²) | passed, 0 errors, 2 warnings (hand corners, jerk 1470/s²) |
| foot slide / bone drift | 0 px / 0 px | 0 px / 0 px |
| story parity (HyperFrames vs Remotion stills) | 0.9517 min SSIM, the low samples are the story camera's follow at 10–12 s; the op-list version of the same story scores 0.8366 there | 0.9973 min SSIM |
| finished renders, whole-video SSIM | 0.971 | 0.989 |

Scene parity: `characters-rig-stick-classic-void` 0.9920 and
`characters-rig-rubber-hose-world` 0.9955 min SSIM (threshold 0.97); the
op-list fixtures `characters-style-rubber-hose` 0.9981,
`characters-style-stick-classic` 0.9994 and `characters-acting` 0.9950 are
unchanged. The other finish gates that fail on the box story (density,
motion, acting, pace) and the void story (motion) are the story's, not the
rig's.

Seen in the renders: feet planted, knees bent, the box carried before the
chest and passed between both pairs of hands, the dropped box stays on the
floor (the op-list render floats it back up), the coin goes from the floor
to Oliver's hand to the top of its arc to Maya's hand. Still off: Oliver's
reach for the coin folds him nearly flat (today's 75° lean on bent knees),
the coin in Maya's far hand hides behind her body, and the close camera at
"coin." loses Oliver as he bends (as it does on the op-list render).

Still open: making it the default for the stick styles (§7 step 4);
held or looped HyperFrames clones of a rig scene; the parity harness's
internal builder (used only when the story compiler fails) does not inline
the runtime; seated sets; scene parity cannot check camera landings (story
parity does).
