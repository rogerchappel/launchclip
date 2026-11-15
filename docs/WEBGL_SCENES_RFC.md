# RFC: Real 3D scenes with three.js

Status: research and design experiment; nothing here is scheduled
Date: 2026-11-16
Builds on: [DUAL_RENDERER_PLAN.md](DUAL_RENDERER_PLAN.md) (the portable-module rule),
[KIT_CONTRACTS.md](KIT_CONTRACTS.md) (modules, painters, parity),
[VIDEO_QUALITY_RFC.md](VIDEO_QUALITY_RFC.md)

## 1. Summary

LaunchClip's 3D today is CSS 3D transforms: flat faces, no real lighting,
shadows, reflections or depth of field. This RFC asks whether real 3D, drawn
with three.js, can raise the quality and depth of the output while keeping the
two things the kit is built on: every frame is computed from the time alone,
and Remotion and HyperFrames draw the same picture.

The research says yes, with conditions:

- A three.js scene renders through Remotion 4.0.543 today with no engine
  change, and the same frame rendered twice is byte-identical (section 3).
- Both renderers already share a seek-driven painter path for canvas modules.
  A three.js scene written as a painter lives once in `kit/core` and is drawn
  by both (section 4).
- Software WebGL, which CI and GPU-less hosts need, is four to eight times
  slower than a GPU, and extra workers make it slower (section 3).
- Parity between the two renderers for a three.js scene has **not** been
  measured. It is the first thing the proof must settle (section 7).

Remotion is the main engine. HyperFrames must stay in parity with it, so a 3D
scene that only one renderer can draw is out of scope.

The proposal is three steps, each useful alone: redraw the existing 3D modules
in real 3D, add a device that shows the user's own screenshot or recording on
its screen, and later add a 3D environment that follows the world camera.

## 2. What exists today

- **CSS 3D catalogue** (`kit/core/catalog-i-3d*.mjs`): `glass-bars-3d`,
  `coin-stack`, `device-box`, `paper-stack` and `rack-shelf` share an orbit
  rig of nested divs; `planet-family` is flat discs with parallax. Each module
  returns a renderer-neutral view tree and a list of 2D timeline ops.
- **No user media in 3D.** `device-box` shows text and gradients on its
  screen. Images appear only in the flat `device-frame`.
- **A shared painter path.** Canvas and interface modules call one pure
  `paint(plan, t)` function. Remotion calls it through `PaintCanvas`;
  HyperFrames drives it from a proxy tween on its paused timeline.
- **The world camera is 2D.** `cameraStateAt` returns `{x, y, zoom,
  rotation}`. `PARALLAX`, `DOLLY` and `ORBIT_DEGREES` are 2D factors.
- **three.js is installed but confined.** `three`, `@react-three/fiber` and
  `@remotion/three` are dependencies used only by the legacy premium
  composition. `test/remotion_package.test.js` fails if a kit file imports
  them, and `WEBGL_MODULES` in `kit/remotion/webgl.ts` is empty.
- **No GL backend is set.** Neither renderer's launch code passes a `gl`
  option or Chrome GL flags, so Chrome decides.

## 3. What was measured

A lit, shadowed scene (a rounded-box device, five bars, a floor, a
`RoomEnvironment` light, a 2048 px shadow map) at 1080×1920, 30 fps, through
`ThreeCanvas` on Remotion 4.0.543 and Chrome 158, macOS arm64.

| Check | GPU (`angle`) | Software (`swangle`) |
|---|---|---|
| Same frame rendered twice | byte-identical | byte-identical |
| 60 frames, one worker | 5.6 s | 21.2 s |
| 60 frames, four workers | 3.7 s | 30.3 s |
| One worker against four, SSIM | 0.9997 | 1.0000 |

GPU against software: SSIM 0.9994 on a still and 0.9990 on the 60-frame clip.
That is well inside the 0.97 parity threshold, and it is not pixel-identical.

The probe scene was a plumbing test. It was badly framed and its glass read as
flat colour, so it says nothing about how good a designed scene can look.

## 4. Design

### 4.1 A scene is a painter

A 3D module returns a **scene description** from `resolve` (meshes, materials,
lights, a camera path) and exports a pure painter:

```
paintScene(canvas, plan, t)
```

The painter builds the three.js scene once per canvas, sets every animated
value from `t`, and renders one frame. It uses plain three.js, not React
Three Fiber, so both renderers call the same code:

- **Remotion** mounts a canvas and calls the painter with the current frame's
  time, the way `PaintCanvas` does now.
- **HyperFrames** calls it from its seek event. Its documentation lists
  three.js as a supported runtime drawn from the seek time, with no animation
  loop.

Rules for a painter, on top of the existing frame-pure rules:

- No clock, no animation loop, no physics step. Frames render out of order.
- Model animation is sought with `AnimationMixer.setTime()`.
- All randomness is seeded.
- Asynchronous work (loading a texture) holds the frame until it is ready,
  through each renderer's own delay mechanism.

### 4.2 The portable-module rule changes

The rule becomes: a kit module may need WebGL if it is listed in
`WEBGL_MODULES` and has a DOM fallback. The CSS 3D drawing of each module
stays as that fallback, for hosts without WebGL and for low-end players. The
test changes from "no kit file imports three.js" to "every module that does is
listed and has a fallback".

### 4.3 Choosing the GL backend

The engine passes the backend explicitly instead of leaving it to Chrome:

- a GPU backend (`angle`) on a desktop with a GPU;
- software (`swangle`) in CI and on hosts without a GPU.

Remotion's documentation notes that `angle` leaks memory on long renders and
fails on GPU-less CI runners, and that its config file does not apply to the
server-side rendering API, so the option must be passed in code. Segmented
rendering already bounds how long one browser lives.

Because software rendering does not speed up with more workers, the capacity
planner should lower concurrency for stories that contain WebGL modules when
no GPU is present.

### 4.4 Look

- **Lighting:** `RoomEnvironment` through `PMREMGenerator`, so no HDR files
  ship with the package.
- **Materials:** physically based, coloured from the style pack.
- **Depth of field, bloom, ambient occlusion:** three.js's own
  `EffectComposer` passes, ending in `OutputPass`. The newer node-based
  pipeline needs the WebGPU renderer, which three.js still marks
  experimental; it is not proposed here.
- **Models:** built from code (rounded boxes, extruded shapes). Remotion's own
  three.js template builds its phone this way. A user may hand in a glTF; the
  kit ships none.

## 5. The three steps

### 5.1 Real-3D drawings of the existing 3D modules

The planner, schemas and prompts do not change. `glass-bars-3d`, `coin-stack`,
`device-box`, `paper-stack` and `rack-shelf` gain a three.js painter driven by
the same content and the same orbit values. This is the proof step: it forces
the painter path, the rule change, the GL choice and the parity measurement.

### 5.2 A device with the user's footage on its screen

A new module: a phone, a laptop or a browser window with a screenshot or a
recording as the screen texture. The camera can orbit the device, push into
the screen and hand over to the full-frame recording.

- **Images first.** A still texture is simple in both renderers.
- **Video second.** Remotion's video-texture hooks are deprecated; the
  documented pattern draws frames from `@remotion/media` into one reused
  canvas texture and advances the render explicitly so no frame is stale.
  HyperFrames needs its own frame-accurate route, not yet investigated.
- The screen is unlit and skips tone mapping, so the footage keeps its
  colours.

### 5.3 A 3D environment behind the world camera

A three.js layer behind the DOM content: particle fields, light shafts, grids
and floating shapes with real parallax and focus blur, while text stays crisp
DOM on top. It needs the world camera to gain depth (a position, a look-at
and a field of view that reduce to today's `{x, y, zoom, rotation}`), so it is
the last and largest step.

## 6. Risks

- **Renderer parity.** Unmeasured. The same painter and the same Chrome family
  suggest it will hold, but antialiasing, shadow filtering and float precision
  are where backends differ. A per-fixture threshold is already supported if
  3D fixtures need a small allowance.
- **Speed without a GPU.** A 3D-heavy story could take several times longer
  in CI or on a GPU-less host.
- **Package weight.** three.js becomes a dependency of the published kit, not
  only of the legacy composition.
- **Two drawings per module.** The CSS 3D fallback and the three.js painter
  can drift apart. The fallback is held to "reads the same", not to pixel
  parity with the 3D drawing.
- **Fonts and text.** Text inside a 3D scene (bar labels, readouts) is either
  DOM laid over the canvas, which needs projecting 3D points to the screen as
  `project()` does now, or a canvas texture, which blurs under zoom. The
  proof should use DOM labels.

## 7. The proof

Redraw `glass-bars-3d` as a painter and answer, with numbers:

1. Remotion against HyperFrames SSIM for the same fixture, on a GPU and on
   software rendering.
2. macOS against Linux, on software rendering.
3. Render time per frame on each backend, and the right concurrency.
4. Whether a designed scene, not the probe, looks clearly better than the
   CSS 3D drawing. If it does not, stop here.

## 8. Not proposed

- **Physics and particle simulation libraries.** They carry state from frame
  to frame and cannot seek to an arbitrary frame.
- **React Three Fiber in the kit.** It would tie scenes to one renderer.
- **A bundled model library.** It costs download size and licence checks for
  little gain over code-built shapes.
- **The WebGPU renderer**, until three.js stops marking it experimental and
  both renderers can use it headlessly.

## 9. Not verified

- Parity between the two renderers for a three.js scene.
- Behaviour on Linux and in CI; every measurement was on macOS arm64.
- Whether openly licensed device models exist that would beat code-built
  ones, and their sizes.
- HyperFrames' own Chrome GL flags and its route for frame-accurate video
  textures.
