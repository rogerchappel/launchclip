# R&D: carry through a moving camera

Status: R&D, open for review
Date: 2026-11-17
Extends: [FLUID_MOTION_RFC.md](../FLUID_MOTION_RFC.md) §6 (carry and pins) and
the first item of §12
Code it builds on: `kit/core/flow.mjs` (pairing, the still plate),
`kit/core/carry.mjs` (the FLIP), `kit/core/camera-world.mjs` (placements,
moves, blur), `kit/core/transitions.mjs` (`sceneWindows`, camera transitions)

## 1. The problem

Carry today needs a still plate: scene B arrives by a cut and the story has no
world camera, so A's last frame and B's first frame share one coordinate
space and B's element can start on A's rect in its own canvas px. A world
camera breaks that. Every plate has a **placement** in one 2D world
(`{x, y, scale, rotation}`), and a camera transition (pan, whip-pan, orbit,
push, pull, overview) moves the camera from rest on A to rest on B while both
plates stay drawn (A through its `renderEnd`, B from its `start`). A rect in
A's canvas px is not a rect in B's.

The direction this serves: a world-camera video is one continuous space, so
carrying an element across a camera move is the camera simply travelling past
it, rather than two scenes trading a card.

## 2. Mapping a rect through the camera at the boundary

At the boundary frame (B's `start`, the move's first frame) the camera rests
on A: moves start from rest, and a shot's own zooms return to rest before its
window ends. So A's canvas px **are** the screen px on that frame, and the
world point under an element is A's placement applied to it:

```
world  = worldPoint(Pa, centreA)                        (camera-world.mjs)
centreB = Pb⁻¹(world)                                    B's canvas px
wB = wA · sA / sB,  hB = hA · sA / sB,  rotB = rotA + rA − rB
```

That box is what the FLIP in `carry.mjs` already consumes (`item.box`, in the
receiving model's canvas px): B's element starts on it as an `x`, `y`, scale
and rotation offset from its slot, measured through B's own ancestors
(node-graph's `-cam` push included). On the boundary frame B's copy is in the
same place in the world as A's, so it is in the same place on screen, and A's
copy hides on that frame. The one new thing on A's side: A stays drawn through
the move, so its handed elements need an explicit `opacity: 0` set at A's
`end` (on a still plate the scene's window ending did that).

Pins follow from the same mapping: an element is a pin only when its mapped
box equals its slot, which across a pan it never is (the plates are a plate
and a gap apart). A same-shape twin across a pan is a carry.

## 3. World-space carry: both scenes framing one world

Once the box is mapped, the element lives in world coordinates: it starts
where A's copy was in the world and ends in B's slot in the world. What is
left to decide is the path it takes **during** the move.

Let the camera move have start `t0`, duration `d` and ease `e` (`cameraPlan`
moves: the grammar's camera ease, or its whip ease on a whip-pan, with
`d` scaled by distance). For a move that keeps zoom and roll (a pan or a
whip-pan between plates of one scale; `besidePlacement` only rebalances the
scale after a chain of pushes), the camera's world centre is
`C(t) = Ca + e(p)(Cb − Ca)` and screen = `z · (world − C(t)) + centre`.

If the element travels in the world with **the same start, duration and
ease**, `E(t) = Ea + e(p)(Eb − Ea)`, then

```
screen(t) − centre = z · (E(t) − C(t)) = (1 − e(p)) · sA + e(p) · sB
```

where `sA`, `sB` are its screen offsets at the two rests. The element moves on
screen in a straight line from where it was on A to where its slot is on B,
with the camera's own slow → fast → slow ease and no overshoot. An element
whose slot is in the same place on both plates (a title, a hub) stays still
on screen while the plates slide past under it: the camera travelling past
it. That is the behaviour the direction asks for, and it falls out of the
existing FLIP with three changes to its timing.

1. **Timing from the camera.** The FLIP's `x`, `y`, scale and rotation tweens
   take the move's `start`, `duration` and `ease` instead of `CARRY_MOVE`.
2. **No flock gap.** Any lag against the camera shows on screen as a swing
   away from the line and back, which reads as an overshoot. Members move in
   unison; the spread comes from their different on-screen deltas.
3. **One ease on both axes.** `CARRY_MOVE`'s `x` `power2` against `y`
   `power3` arc is dropped for the same reason.

A world-mode cut (a plate stacked on the last one, same placement, no move) is
the still plate: the mapping is the identity and the FLIP keeps `CARRY_MOVE`.

### Moves that change zoom or roll (push, pull, orbit, overview)

The same world travel is not exact once `z` changes over the move. With
`d = sA = sB` (an element that should stay put on screen) through a 2× dolly:

```
screen offset / d = z(t) / z_A · (1 − e/2)
```

With the camera's zoom on a log scale (`scaleLerp` for wide zooms) that peaks
at about 1.06 mid-move, so an element 300 px from centre bulges out 18 px and
comes back; with a linear zoom it is 1.125 (37 px). Orbit has the same
problem with roll. That is an overshoot on screen, which the camera rules
forbid.

The exact answer is a **ride layer**: a wrapper around the carried element
whose transform cancels the camera, `Pb⁻¹ ∘ Frame(t)` in B's canvas px (the
camera's framing at `t` expressed in B's coordinates, identity at B's rest).
Inside it, B's canvas px are screen px for the whole move, so the element can
do an ordinary screen-space FLIP with carry's own eases and the flock gap. Its
cost: a new wrapper in the view, conjugated by the element's ancestors (a
`-cam` push inside node-graph scales it), and a reciprocal of the camera's
stepped zoom (`scaleTweenOps`) as its own stepped tween. Not in the first
slice.

### Pinned to the world instead?

The alternative reading, the element stays at its world position and the
camera leaves it behind, is what already happens with no carry at all (A's
element exits with A). It is not a carry. A landmark that stays in the world
and is passed by the camera is a world backdrop
(`kit/core/world-backdrops.mjs`), not a scene element.

## 4. Whip and push

- **Whip-pan** is a camera transition in both modes (`isCameraTransition`), so
  it is covered by §3: the carried element rides the whip with the whip ease.
  An element in the same slot holds still on screen while everything else
  smears past.
- **Pan** in either mode: the same.
- **Push / pull in world mode** and **orbit**: zoom or roll changes; refused
  until the ride layer (above).
- **Push in a cuts story** is not a camera move: it is a typed slide where
  both layers translate (`transitions.mjs` `typedTweens`). The same reasoning
  applies with B's layer tween in the role of the camera (map A's rect by the
  layers' offsets at the boundary, travel with the layer's ease). Feasible as
  a follow-up; it needs the layer tweens from `sceneWindows` in the flow pass.
- **Overview** (out, hold, in): two moves and a change of zoom; out.

## 5. Motion blur at peak speed

The camera blur is one directional `feGaussianBlur` on the camera container
(`#lc-camera` in HyperFrames, the same filter in Remotion), driven by the
camera's screen velocity. A carried element is drawn inside the container,
so it takes the camera's smear. For an element that changes slot that is
roughly right: it travels on screen with the same ease, so its peak speed
lines up with the camera's. For an element that holds still on screen it is
wrong in principle (it does not move, yet it blurs), but on a whip-pan the
smear lasts the 2–4 frames at peak speed and reads as part of the whip; on a
pan the grammar's `moveBlur` is 0 or 0.5 and below threshold at the ends.

Correct per-element blur would need the carried element drawn outside the
camera container (an overlay layer with its own velocity blur), which also
breaks its stacking with the plate it lands in. Unproven; see §7.

## 6. The first slice

- **Pairing** (`flow.mjs`): a boundary is carry-able when B arrives by a cut
  (still plate, world or cuts mode) or by a camera move that keeps zoom and
  roll (pan, whip-pan, either mode). Push, pull, orbit, overview and any
  other typed transition keep their own look; an explicit `carry` map that
  crosses one is a validation error that says why.
- **Rects**: A's boxes mapped through the two placements (§2), from a camera
  plan the flow pass builds itself (`cameraPlan` with a bare-model object
  lookup, so it never resolves a carried model).
- **The FLIP** (`carry.mjs`): unchanged, with its timing taken from the move
  (§3) when there is one.
- **A's hand-off**: an `opacity: 0` set at A's `end` on the handed elements.
- Nothing in either renderer: it is all ops on ordinary ids. Parity fixtures
  sample the boundary, mid-move and the landing; a 9:16 sample pans and whips
  between three node-graph plates in a world-camera story.

## 7. What stays unproven

- Push, pull, orbit and overview (zoom or roll changes): the ride layer of §3.
- The cuts-mode push (a typed slide), §4.
- Per-element blur from the element's own screen velocity, §5.
- A carried element whose B slot is far off its A position across a long
  pan: it crosses the frame with the camera, which may read as a second
  subject; the motion check has no rule for it yet.
- Riders and overlays (track ≥ 1) carried by a plate: they already travel
  with the camera (`rideOf`); carrying one between plates is not tried.
- Footage cutaways in a world-camera story: the source pairing skips them, but
  the plate that comes back has a new placement, so the element would travel
  from the old plate's world position. Untested.
