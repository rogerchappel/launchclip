# Standalone Remotion Runtime Contract

Use this reference without relying on an installed Remotion or HyperFrames
plugin or skill pack. Remotion renders a React composition into video, one
frame at a time, in headless Chrome. LaunchClip drives it from one storyboard
file, `storyboard.json`, through the bundled `LaunchclipStory` composition.

## Contents

- [Prerequisites](#prerequisites)
- [Scaffold without a skill pack](#scaffold-without-a-skill-pack)
- [Local source preparation](#local-source-preparation)
- [Composition contract](#composition-contract)
- [Frame-pure rule](#frame-pure-rule)
- [Motion grammar and world camera](#motion-grammar-and-world-camera)
- [Modules and the custom escape hatch](#modules-and-the-custom-escape-hatch)
- [Design and motion quality contract](#design-and-motion-quality-contract)
- [Verification loop](#verification-loop)
- [Preview and approval](#preview-and-approval)
- [Render and verify](#render-and-verify)
- [Known failure modes and repairs](#known-failure-modes-and-repairs)

## Prerequisites

- Node.js 22 or newer
- FFmpeg and `ffprobe`
- the pinned toolchain: `remotion@4.0.536`, `@remotion/cli@4.0.536`,
  `@remotion/transitions@4.0.536`, `react@19.3.1` and `react-dom@19.3.1`
- the bundled font packages (`@fontsource/*` and `@fontsource-variable/*`
  at `5.3.0`, listed in the install command below); the kit imports their
  files, so the bundle fails without them
- network access for the first `npm install` and Chrome Headless Shell
  download only; rendering itself fetches nothing

Check the host first:

```bash
node --version
ffmpeg -version
npx remotion versions
npx remotion browser ensure
```

`npx remotion versions` must report `4.0.536` for every Remotion package. Any
mismatch is a defect to fix before authoring; Remotion refuses or misbehaves
with mixed versions. `browser ensure` downloads Chrome Headless Shell once.

## Scaffold without a skill pack

Do not run `npx create-video` or install templates. A LaunchClip Remotion
project is a directory holding `storyboard.json`, `assets/`, the planning files,
and a copy of this skill's kit:

```
<project>/
  BRIEF.md, EVIDENCE.md, STORYBOARD.md, DESIGN.md, …   planning files
  STORY.json              the creative retention-story receipt (not the storyboard)
  storyboard.json         the storyboard; the only file most runs author
  NARRATION.json          measured word timings (anchors resolve against it)
  BEATS.json              optional beat map (beat:<n> anchors)
  assets/                 approved media, fonts, audio, captions
    audio/mix.wav         the one offline mix
    captions/captions.json
    fonts/
  kit/remotion/           copy of <skill>/assets/remotion-kit
  kit/core/               copy of <skill>/assets/core
  remotion/entry.tsx      optional entry override (custom modules only)
  remotion/modules/       optional bespoke TSX modules (bespoke tier only)
  .launchclip/story.resolved.json   generated props; never edit by hand
  renders/  qa/
```

The storyboard is `storyboard.json`, never `story.json`: on a case-insensitive
filesystem (macOS by default) `story.json` and the `STORY.json` receipt are the
same file. LaunchClip tools treat a project with `storyboard.json` and no
`index.html` as a Remotion project, so never leave a HyperFrames `index.html`
in it.

Install the toolchain once in the **parent** directory so `node_modules` stays
outside the project. The project root is Remotion's public directory, and
Remotion copies the whole public directory into every bundle; a
`node_modules` inside it makes each render slow and huge. Node and `npx`
resolve packages by walking up, so a parent install serves every project:

```bash
mkdir -p <project>/assets <project>/renders <project>/qa <project>/kit
cp -R <skill>/assets/remotion-kit <project>/kit/remotion
cp -R <skill>/assets/core <project>/kit/core
cd <project>/..
test -f package.json || npm init -y >/dev/null
npm install --save-exact remotion@4.0.536 @remotion/cli@4.0.536 \
  @remotion/transitions@4.0.536 react@19.3.1 react-dom@19.3.1 \
  @fontsource-variable/big-shoulders-display@5.3.0 \
  @fontsource-variable/bricolage-grotesque@5.3.0 \
  @fontsource-variable/dm-sans@5.3.0 @fontsource-variable/fira-code@5.3.0 \
  @fontsource-variable/fraunces@5.3.0 @fontsource-variable/inter@5.3.0 \
  @fontsource-variable/jetbrains-mono@5.3.0 @fontsource-variable/lexend@5.3.0 \
  @fontsource-variable/manrope@5.3.0 @fontsource-variable/oswald@5.3.0 \
  @fontsource-variable/outfit@5.3.0 \
  @fontsource-variable/playfair-display@5.3.0 \
  @fontsource-variable/plus-jakarta-sans@5.3.0 @fontsource-variable/sora@5.3.0 \
  @fontsource-variable/space-grotesk@5.3.0 \
  @fontsource-variable/stix-two-text@5.3.0 @fontsource-variable/syne@5.3.0 \
  @fontsource-variable/unbounded@5.3.0 @fontsource/anton@5.3.0 \
  @fontsource/archivo-black@5.3.0 @fontsource/bebas-neue@5.3.0 \
  @fontsource/dm-serif-display@5.3.0 @fontsource/instrument-serif@5.3.0 \
  @fontsource/stix-two-math@5.3.0 @fontsource/young-serif@5.3.0
```

The default output, `.launchclip/agent-<slug>`, therefore installs into
`.launchclip/`. Keep the kit copy unmodified; project-specific code belongs in
`remotion/`. Keep planning files at the project root, approved media under
`assets/`, and renders under `renders/`.

Map the chosen aspect to `format`: `9:16` to 1080×1920, `1:1` to 1080×1080,
and `16:9` to 1920×1080, at 30 fps unless the brief asks for 60.

## Local source preparation

Probe supplied media before editing:

```bash
ffprobe -v error \
  -show_entries format=duration,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels \
  -of json <input>
```

Detect boundary silence locally. Start with `-30dB` and a half-second minimum,
then inspect the reported boundaries rather than copying them blindly:

```bash
ffmpeg -hide_banner -i <input> \
  -af silencedetect=noise=-30dB:d=0.5 \
  -f null - 2>&1
```

Trim leading/trailing silence with a small speech handle. Re-encode at a
constant frame rate equal to `format.fps`, because Remotion seeks video by
frame and variable-frame-rate sources drift; preserve internal pauses:

```bash
ffmpeg -ss <start-with-handle> -to <end-with-handle> -i <input> \
  -r <fps> -c:v libx264 -crf 18 -preset medium \
  -c:a aac -b:a 192k -movflags +faststart \
  <project>/assets/source-trimmed.mp4
```

For narration-led edits, transcribe on the host with a local ASR engine that
emits word timestamps, for example local Whisper:

```bash
whisper <project>/assets/source-trimmed.mp4 --model small.en \
  --word_timestamps True --output_format json --output_dir <project>/qa/asr
```

Convert the result into `NARRATION.json` words (`[{text, start, end}]`). Do not
replace this with a paid transcription API in subscription mode.

Generate two views of the source: a whole-piece overview and a dense opening
strip. Adjust the overview step and tile geometry for the duration and aspect:

```bash
ffmpeg -i <project>/assets/source-trimmed.mp4 \
  -vf "fps=1/<overview-step>,scale=480:-2,tile=4x3" -frames:v 1 \
  <project>/source-overview.jpg

ffmpeg -ss 0 -t 4 -i <project>/assets/source-trimmed.mp4 \
  -vf "fps=2,scale=480:-2,tile=4x2" -frames:v 1 \
  <project>/source-hook-strip.jpg
```

For a reference video, detect probable cuts and inspect a frame immediately
before, at, and after each relevant boundary. Record observations in
`SOURCE.md`; do not infer edit rhythm from a single contact sheet.

### Downloaded HeyGen avatar handoff

For an already-generated, authorized HeyGen video, keep the original brief,
repository, URL, or research document as the evidence source and promote the
local avatar MP4 to production media. Prepare it exactly like other presenter
footage, then extract one continuous narration track:

```bash
ffmpeg -i <project>/assets/heygen-avatar-prepared.mp4 \
  -vn -c:a pcm_s16le -ar 48000 \
  <project>/assets/audio/heygen-avatar-voiceover.wav
```

Feed that track into `build-mix.mjs` as `--voice`, so it plays once through the
root mix. Show the avatar as muted `<OffthreadVideo>` segments only in scenes
where the presenter is visible, with `startFrom` equal to the scene's start
frame so every segment follows the continuous narration timeline; do not
restart the avatar at every scene. This allows full-frame graphics during
voiceover scenes without interrupting speech and prevents duplicate audio when
presenter layouts overlap at transitions.

Do not leave a HeyGen download URL in the project, call the HeyGen API, or
request credentials in this workflow. Confirm likeness authorization and the
final spoken script before authoring around the file.

## Composition contract

`storyboard.json` (`schema: "launchclip.story.v1"`) is the source of truth. The
kit's `kit/remotion/Root.tsx` registers one composition, `LaunchclipStory`,
whose props are the **resolved** story, plus review compositions for single
modules. Treat these rules as the contract:

- `format` gives `width`, `height`, `fps` and `duration`; `calculateMetadata`
  derives the composition size and `durationInFrames` from it. Never hard-code
  dimensions or duration in a component.
- Every scene has a unique `id`, a catalogue `module`, `start` and `end` (seconds,
  `word:<text>[#n]` or `beat:<n>` anchors), optional `track` (default 0),
  `energy`, `params`, `hits`, and an optional typed `in` transition. Scenes may
  overlap only on different tracks.
- `in` describes the transition **into** the scene:
  `{type: "cut"|"fade"|"push"|"whip"|"zoom"|"iris"|"morph", dur, from_object?, direction?}`.
  A `morph` or a `from_object` makes the boundary `shared-world`; anything else
  is `ordinary`. These are the phase-2 declared boundaries that
  `cinematic-check` and the evidence builder read, with `boundary_id`
  `<scene-id>-in` and `sequence_id` set to the `from_object` scene.
- `audio.narration` (`{text, provider?, voice?, speed?}`) is the script
  `launchclip finish` synthesises into `audio.voice` and `audio.words`
  (defaults: Kokoro, `af_heart`, speed 1.2); see "Narration" under
  "Render and verify". `audio.mix` names the one offline mix; `overlays`
  holds captions; `ending` can loop to a scene.
- Asset paths are project-relative under `assets/` (`"assets/media/demo.mp4"`),
  without a leading slash, and resolve through `staticFile(path)`.

Resolve anchors into props after every edit to `storyboard.json`,
`NARRATION.json` or `BEATS.json`:

```bash
cd <project>
launchclip story resolve storyboard.json --narration NARRATION.json \
  --beats BEATS.json --out .launchclip/story.resolved.json
```

Omit `--beats` when there is no beat map; without `--narration` the words file
named by `audio.words` is used. Without the CLI, call `resolveStory(story,
{words, beats})` from `kit/core/story.mjs` and write its JSON to the same path.

The LaunchClip renderer adapter writes the same file. Every Remotion command
below passes it with `--props=.launchclip/story.resolved.json` and uses the
project as `--public-dir=.`. The entry is `remotion/entry.tsx` when the project
overrides it and `kit/remotion/entry.tsx` otherwise; examples use the latter.

`StoryComposition` builds the timeline from the resolved story:

- One `<Sequence>` per scene, `from={Math.round(start * fps)}` and
  `durationInFrames={Math.round((end - start) * fps)}`, with
  `premountFor={fps}` so media and fonts load before the scene appears. A
  module inside it computes absolute time as `t = scene.start + frame / fps`.
- Typed boundaries as frame-pure layer styles from `kit/core/transitions.mjs`,
  the same tween table the HyperFrames compiler turns into GSAP, so both
  renderers move the same layers by the same amounts with the same eases.
  Every track-0 scene is an opaque plate in `brand.colors.bg`: `fade` fades the
  incoming plate in, `push` slides both plates (`direction`, default `left`),
  `whip` slides them on `expo.inOut` with a blur that peaks mid-move and
  returns to zero, `zoom` scales the outgoing plate up while the incoming one
  grows in, `iris` opens a circle onto the incoming plate, `morph` crossfades
  while the modules hand the shared object across, and `cut` does nothing.
  Because same-track scenes cannot overlap, the kit holds the outgoing track-0
  scene on screen until the incoming transition settles (its module's exit
  moves to the end of that window); scenes more than 0.1 s apart show the
  background in between. The kit does not use `TransitionSeries`, which
  overlaps neighbours and shortens the series, so story times stay
  authoritative. Do not hand-build a `TransitionSeries` against story times.
- Ambient motion from `kit/core/ambient.mjs`, evaluated at the absolute time
  of every frame, so settled frames keep moving between beats. Each track-0
  plate draws a background field under its content: a few large, soft,
  low-alpha blobs of the brand `primary` and `accent` colours that glide
  slowly across the canvas, wrapping only while off canvas. Each eligible
  scene's content sits in a hold-drift wrapper: a linear push-in about the
  module rect's centre (scale up to 2–4% plus a few px of vertical travel)
  from the scene start to the end of its render window, clamped to the safe
  zone and clear of the caption band, or a small pull-back when the rect has
  no room. `story.ambient` (`off | subtle | standard | lively`, or
  `{level, background, drift}`) and a per-scene `ambient` override control it.
  The default level follows each scene's `energy` (0 → subtle, 1, 2 and
  `"build"` → standard, 3 → lively). The footage-led lane gets no field and
  drifts overlays only. Leave it on: with `ambient: "off"`, settled frames
  hold still and the cinematic motion gate fails. The HyperFrames compiler
  draws the same field and drift from the same functions, and
  `launchclip layout-check` checks every drifting rect at its largest extent.
- Exactly one `<Audio src={staticFile(story.audio.mix)} />` at the root, spanning
  the whole composition (the voice when there is no mix). No scene, module, or
  video plays its own audio.
- Captions through the kit's `<WordCaptions>`, mounted once on the top layer
  for the full duration: from the captions overlay's `src`
  (`assets/captions/captions.json`), or chunked from `audio.words` when `src`
  is absent. `overlays[].hide` ranges and scenes whose module sets
  `hidesCaptions` hide them. The chunking, band, pop and per-word highlight are
  the HyperFrames runtime's (`kit/core/captions.mjs`).
- The loop ending, when `ending.loop_to` is set, returns to that scene's frame
  zero state: over `ending.in.dur` with the typed transition when `ending.in`
  is set, otherwise on the last frame.
- Fonts come only from bundled files (see [Fonts](#fonts)), never from Google
  Fonts or the host's installed fonts.
- A scene whose module is unknown, invalid, or has no component renders a
  labelled placeholder box, never a blank frame. `launchclip finish` fails its
  validate stage on a scene whose params do not resolve and its `placeholders`
  gate on any scene that would render as one.
- A `footage-led` story adds a `base` recording (`{src, trim | edl, volume,
  fit, focus}`; see `recorded-video.md`).
  - `BaseLayer` mounts it under every scene: one
    `<OffthreadVideo trimBefore={sourceStart * fps} volume={base.volume}>` per
    trim segment, each in its own Sequence, so timeline time is trimmed base
    time.
  - This is the one exception to "no video plays its own audio". The
    recording's sound comes from the base video, and the root `<Audio>` plays
    only `audio.mix`, the bed, at `audio.mix_volume`.
  - `punch-in` scenes render nothing themselves. Their `model.camera` samples
    transform the base wrapper through the same op list that HyperFrames turns
    into GSAP.
  - `insert: true` scenes are track-0 plates over the base. Overlays sit on
    tracks 1 and up.
  - `ModuleReview` shows footage-led modules over the muted base.
  - Resolve `base.edl` into `base.trim` with
    `launchclip story resolve` or `resolveStory(story, {edl})` before
    rendering.

`launchclip story compile <project> --renderer remotion` resolves the story,
writes `.launchclip/story.resolved.json` and proves the bundle lists
`LaunchclipStory`.

Media rules:

- Use `<OffthreadVideo muted src={staticFile(...)} startFrom={frames} />` for
  video and `<Img src={staticFile(...)} />` for images. Do not use raw `<video>`,
  `<img>` or `<audio>` tags: Remotion cannot wait for or seek them.
- Never use remote URLs, provider URLs, or expiring URLs. Freeze every asset
  under `assets/` before preview or render.
- Do not change `playbackRate` on narration or presenter footage.

For presenter-plus-graphic layouts, measure the source focal point and compute
the crop against the target rectangle. Given a source crop
`(u0, v0, u1, v1)`, source dimensions `(sw, sh)`, scale `s`, and target origin
`(tx, ty)`, place the video at `left = tx - u0*s` and `top = ty - v0*s` with
`width = sw*s`, inside a wrapper sized to the target rectangle with
`overflow: hidden`. This keeps the transformed crop flush with the intended
panel instead of creating a dead band. Recompute the crop when scale or focal
point changes, and drive any change of `s` from the frame.

Build music and cue audio offline into `assets/audio/mix.wav` with
`build-mix.mjs`. Keep supplied presenter audio at full program level, start
music conservatively around 10–18%, and bind each SFX cue to a visible event,
ideally the scene `hits` and module events. When beat alignment is useful,
precompute `BEATS.json` locally and anchor hits with `beat:<n>`; do not
analyse audio at render time.

## Frame-pure rule

Every pixel is a pure function of the current frame. Remotion renders frames
out of order, in several browser tabs at once, and Studio seeks freely, so any
hidden state becomes a visible defect.

- Derive all motion from `useCurrentFrame()` and `useVideoConfig().fps`
  through `kit/core/motion.mjs`: `tween`, `track`, `stagger`, `countUp`,
  `springValue`, `splitWords`, `splitChars` and `motionBlurPx`. Its eases match
  GSAP's names (`power3.out`, `back.out(1.4)`, `steps(6)`) to within 1e-6, so
  a storyboard written in GSAP terms maps one-to-one. Remotion's own
  `interpolate()` and `spring()` are also frame-pure and allowed.
- No animation state in `useState`, `useReducer`, `useRef` or `useEffect`, and
  no module-level mutable variables. A component may compute derived values in
  render, nothing more.
- No `Math.random()`, `Date.now()`, `new Date()`, or `performance.now()`. Use
  `random("<seed>")` from `remotion` for seeded variation.
- No CSS `transition`, `animation`, `@keyframes`, or animated SVG `<animate>`.
  They run on wall-clock time, not on the frame.
- Load fonts before the first frame. The kit does this for every registry
  family and frozen brand font (see [Fonts](#fonts)); a bespoke module that
  needs another face packages its file under `assets/fonts/` and blocks
  rendering until it loads:

```tsx
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

const fontHandle = delayRender("Load display font");
const display = new FontFace("Display", `url(${staticFile("assets/fonts/Display.woff2")}) format("woff2")`);
display.load()
  .then(() => { document.fonts.add(display); continueRender(fontHandle); })
  .catch((error) => cancelRender(error));
```

Never load fonts from the network (`@remotion/google-fonts` downloads from
Google at render time, and the output then depends on the host).
Every `delayRender()` must reach `continueRender()` or `cancelRender()`.

### Fonts

`kit/core/fonts.mjs` is the font registry both renderers share: Anton, Archivo
Black, Bebas Neue, Big Shoulders Display, Bricolage Grotesque, DM Sans, DM
Serif Display, Fira Code, Fraunces, Instrument Serif, Inter, JetBrains Mono,
Lexend, Manrope, Oswald, Outfit, Playfair Display, Plus Jakarta Sans, Sora,
Space Grotesk, STIX Two Math, STIX Two Text, Syne, Unbounded and Young Serif,
each from a pinned `@fontsource` package (OFL-1.1, latin subset). Every
composition calls `ensureFonts(brand)` from `kit/remotion/fonts.ts`, which:

- loads every role default (display Anton, body Inter, meta JetBrains Mono,
  maths STIX Two Text, quote serif Instrument Serif), STIX Two Math as the
  symbol fallback, and every family `brand.fonts` names;
- imports each registry woff2 from `node_modules`, so the Remotion bundler
  copies it into the bundle; nothing goes through `--public-dir` and nothing
  is fetched, in Studio, `remotion render` and `remotion still` alike;
- loads frozen files from `<public-dir>/assets/fonts/` with `staticFile()`
  instead when they exist for a family, named
  `<family-slug>-<weight>[-italic].woff2` (`poppins-700.woff2`), which is how
  a brand family outside the registry is added;
- adds each face with the FontFace API inside `delayRender()` and releases the
  handle once `document.fonts` is ready, so no frame shows a fallback face.

A family that is neither registered nor frozen logs a warning and renders in
the role's bundled family. The HyperFrames compiler makes the same choice per
family, which is what keeps the two renderers' text identical. A custom entry
(`remotion/entry.tsx`) that renders its own compositions calls
`ensureFonts(story.brand)` too.

A minimal frame-pure bespoke module:

```tsx
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { motionBlurPx, tween } from "../../kit/core/motion.mjs";

export default function SignalLabel({ scene, params }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = scene.start + frame / fps;
  const enter = tween(t, { from: 64, to: 0, start: scene.start, duration: 0.4, ease: "power3.out" });
  const exit = tween(t, { from: 0, to: -48, start: scene.end - 0.28, duration: 0.28, ease: "power2.in" });
  const before = tween(t - 1 / fps, { from: 64, to: 0, start: scene.start, duration: 0.4, ease: "power3.out" });
  const blur = motionBlurPx(Math.abs(enter - before));
  const { x, y, width, height } = params.rect;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: x, top: y, width, height,
        transform: `translateY(${enter + exit}px)`, filter: `blur(${blur}px)` }}>
        {params.label}
      </div>
    </AbsoluteFill>
  );
}
```

## Motion grammar and world camera

`motion.grammar` (`editorial` default, `snappy`, `smooth`, `playful`,
`documentary`, `cinematic`) sets the eases, durations and staggers of module entrances and
exits, pops and typed transitions; it reaches the components through the
resolved models (`resolveModule`), so custom components should read
`model.motion.enterEase`/`exitEase` rather than hard-coding eases. A world
camera (`camera.mode` "world", or a `pan`, `whip-pan`, `orbit` or `pull`
transition in a cuts story) makes `LaunchclipStory` draw the track-0 plates at
their world placements inside `CameraWorld` (`kit/remotion/StoryComposition.tsx`),
which evaluates `cameraPlan()` (`kit/core/camera-world.mjs`) per frame: pan,
zoom and drift containers, the parallax background, overlay parallax and a
directional SVG motion blur that is zero at rest. The HyperFrames compiler
plays the same op list through GSAP, so both renderers match frame for frame.

## Modules and the custom escape hatch

Build scenes from the catalogue first. A scene names a module and passes its
parameters; the kit owns geometry, motion windows, events, theme and caption
policy:

```json
{ "id": "s2", "module": "metric", "start": 4.2, "end": 9.6, "track": 0,
  "in": { "type": "push", "dur": 0.5, "direction": "left" },
  "params": { "rect": { "x": 90, "y": 420, "width": 900, "height": 520 },
              "title": "Build time", "accent": "#FDB022",
              "metric": { "mode": "illustration", "unit": "example minutes",
                          "format": "number", "decimals": 0,
                          "values": [{ "value": 48, "at": 0.6 }, { "value": 12, "at": 2.4 }] } },
  "hits": [{ "at": "word:twelve", "event": "settle" }] }
```

For the 14 editorial kinds, `module` is the kind name and `params` is the
editorial specification from `editorial-ui-modules.md` **without** `id`,
`kind`, `aspect`, `start` and `duration`; those come from the scene and the
format. Each React module renders the model from `resolveEditorialModule()` at
absolute canvas coordinates inside a full-canvas `AbsoluteFill`, with the same
events and layout as the HyperFrames emitter. Unknown parameters are errors,
not silently dropped.

The bespoke tier (flagship models only) may add a custom module when no
catalogue module can express a topic-specific world:

- Put the TSX in `remotion/modules/<name>.tsx`, default-exporting a component
  that receives `{scene, params, brand, format, model}`, where `params` is
  `scene.params` and `scene.start` is absolute. Set the scene's `module` to
  `"custom"` and `params.component` to `<name>`.
- Register it through `remotion/entry.tsx`, which registers the kit's
  compositions with a `customModules` map under the same `LaunchclipStory` id
  and metadata. Leave every kit file unmodified:

```tsx
import React from "react";
import { registerRoot } from "remotion";
import { LaunchclipCompositions } from "../kit/remotion/Root";
import SignalLabel from "./modules/SignalLabel";

registerRoot(() => <LaunchclipCompositions customModules={{ SignalLabel }} />);
```
- Follow the frame-pure rule exactly, declare `params.rect` (and any other
  occupied rectangles) so `launchclip layout-check` can see the footprint, and
  obey the same safe-zone, caption-band, minimum text size, contrast, and
  settle rules as catalogue modules.
- Use only DOM, SVG and CSS. No WebGL, `@remotion/three`, or canvas
  libraries in portable modules.
- A custom module that still fails a gate after the repair budget falls back
  to the nearest catalogue module rather than shipping.

## Design and motion quality contract

Treat `DESIGN.md`, `STORYBOARD.md`, and `QUALITY.md` as executable creative
constraints:

- Map type roles into `brand.fonts` with three explicit roles: display, body,
  and metadata, and load them as described in the frame-pure rule. A silent
  fallback to Arial, Helvetica, Times, or generic monospace is a failed review
  unless the design deliberately specifies it.
- Establish hierarchy through type scale, width, weight, tracking, space, and
  contrast. Keep one dominant reading target per frame.
- Build foreground, subject, and atmospheric depth as separate layers so
  camera movement has parallax instead of looking like a flat slide.
- Use transforms for primary movement. Match exit acceleration to the next
  scene's entry direction when objects or camera energy continue across a cut.
- Use distinct easing characters: `expo.out` or `power4.out` for decisive
  acquisition, `power2.inOut` for controlled travel, `back.out(1.2)` for rare
  emphasis, and accelerating `.in` curves for exits. Linear motion is reserved
  for mechanical or intentionally constant movement.
- Simulate motion blur with `motionBlurPx()` driven by per-frame velocity,
  stretched duplicates, or low-opacity ghost layers. Blur must resolve to zero
  at the settle frame so text and UI remain sharp.
- Reserve hard cuts for contrast. Pushes preserve direction, zooms change scale,
  morphs preserve identity, whips create an energetic discontinuity, and irises
  redirect focus. Each must have a visibly different spatial behavior.
- Prefer the storyboard's motion grammar and world camera to hand-tuned eases:
  `motion.grammar` keeps one easing character across the piece, and
  `camera.mode` "world" gives camera travel with parallax depth, a slow drift
  through holds and velocity-shaped blur from one tested implementation.
- The first frame must already communicate an intentional state: render and
  inspect a still of frame 0 itself. A module whose entrance animates in can
  be blank on frame 0 even at `at: 0`, so open on one that is readable on
  frame 0 (`hook-title`), or check the still and adjust. The first
  second states the promise. The first four seconds contain at least three
  meaningful changes in layout, evidence, framing, or visual register for
  portrait, or two for landscape.
- Keep outgoing and incoming shared-world planes alive for the full declared
  transition duration: let the outgoing scene's `end` meet the incoming
  scene's `start` and the kit holds it until the incoming scene settles. Use
  one continuous position curve and a velocity-shaped blur
  envelope: zero blur at departure, strongest near peak speed, and zero at
  settle.

Prefer a small authored scene grammar over a rigid template: presenter anchor,
presenter-plus-proof split, full-frame diagram, kinetic type reset, evidence/UI
focus, and closing lockup. Reuse the design system, not the same layout.

## Verification loop

Validate the storyboard after the first authoring pass and after every edit,
then re-resolve the props:

```bash
launchclip story validate storyboard.json --narration NARRATION.json
```

Then run the data-driven layout gate. It sweeps the timeline using every
module's declared rectangle and motion windows and checks safe-zone bounds,
same-time collisions, caption-band clashes, and minimum text size:

```bash
launchclip layout-check <project> --profile shorts --json
```

Use `--profile landscape` for 16:9 deliveries.

Render stills and inspect them with the available image viewer. Frames are
`Math.round(seconds × fps)`:

```bash
cd <project>
npx remotion still kit/remotion/entry.tsx LaunchclipStory qa/stills/f-0000.png \
  --frame=0 --props=.launchclip/story.resolved.json --public-dir=.
```

Each `still` bundles the project again; for the dense hook, render a frame
range once with `npx remotion render … --sequence --image-format=png
--frames=0-120` into `qa/stills/hook/`. Check first, midpoint,
transition-boundary, and final frames for:

- clipped, overflowing, tiny, or unreadable text
- accidental overlap or platform-unsafe placement
- missing or black media panels
- blank or static scenes
- weak hierarchy, repetitive layouts, or generic filler
- discontinuities between adjacent scenes
- late hook acquisition, a motionless opening, or fewer than two meaningful
  first-four-second changes
- repeated card templates, identical easing on every object, permanent blur,
  and generic-font substitution

Do not mark collisions as intentional unless the overlap is deliberate and
documented in the storyboard. Repair a `params` value or a scene time, never a
layout threshold.

View stills at delivery size. An overview can hide weak hierarchy, tiny type,
one-frame overlaps, or a blur that never resolves. When a transition is
suspect, render neighbouring frames one at a time and repair the scene rather
than accepting the artifact.

Every `storyboard.json` project is phase 2. Build `qa/temporal-evidence/manifest.json`
from exact samples. Clamp every timestamp to the composition duration and
deduplicate it:

- hook: `0,0.25,0.5,0.75,1,1.5,2,3,4`
- ordinary boundary: 0.05 seconds before, midpoint, and 0.05 seconds after
- shared-world move: 0.05 seconds before, departure, 20%, 50%, 80%, settle,
  and 0.05 seconds after
- final hold: 0.05 seconds before the composition duration

Also capture useful sequence entry, settled-state, shot-midpoint, and planned
visible-event samples when they add evidence beyond the required schedule.
These supplemental entries are not substitutes for hook, boundary, or
final-hold samples.

Capture both a browser still and a frame extracted from the encoded draft for
every required sample; the latter proves the delivered artifact rather than
only the browser render. One command does all of it:

```bash
node <skill>/scripts/build-evidence.mjs <project> --renderer remotion
```

Add `--entry remotion/entry.tsx` when the project overrides the entry; set
`REMOTION_BIN` to a local `remotion` binary to skip `npx`.

It derives the schedule from the boundaries declared in `storyboard.json`, renders
`qa/temporal-evidence/<sample-id>-browser-still.png` through the Remotion
adapter, extracts `<sample-id>-encoded-draft.png` from `renders/draft.mp4`
with FFmpeg, writes the hashed manifest, and builds paired contact sheets in
`qa/critic-sheets/` (left tile = browser still, right tile = encoded draft).
Do not reuse the browser still as encoded-draft evidence. The manifest shape:

```json
{
  "schema_version": "launchclip.subscription-temporal-evidence.v1",
  "video_sha256": "<sha256-of-renders/draft.mp4>",
  "entries": [
    {
      "sample_id": "hook-001",
      "evidence_id": "hook-001-browser-still",
      "source": "browser-still",
      "role": "hook",
      "at_seconds": 0,
      "sequence_id": null,
      "boundary_id": null,
      "file": "qa/temporal-evidence/hook-001-browser-still.png",
      "sha256": "<sha256-of-this-image>"
    },
    {
      "sample_id": "hook-001",
      "evidence_id": "hook-001-encoded-draft",
      "source": "encoded-draft",
      "role": "hook",
      "at_seconds": 0,
      "sequence_id": null,
      "boundary_id": null,
      "file": "qa/temporal-evidence/hook-001-encoded-draft.png",
      "sha256": "<sha256-of-this-image>"
    }
  ]
}
```

Give each scheduled sample a stable `sample_id` and exactly two uniquely named
evidence entries, one for each source. Copy the schedule's role, timestamp,
sequence ID, and boundary ID exactly; use `null` when an ID does not apply.
Fail the review when an expected source is missing, a file is empty, the
current draft hash changed, an artifact hash is stale, a timestamp is out of
range, or the fresh-context critic did not list every evidence ID it reviewed.

Then run the gate against the Remotion adapter:

```bash
launchclip cinematic-check <project> --renderer remotion \
  --video renders/draft.mp4 --critique qa/critic.json \
  --expect-audio --audio-manifest AUDIO-MANIFEST.json
```

## Preview and approval

After all gates and still inspection pass, open the editable Studio:

```bash
cd <project>
npx remotion studio kit/remotion/entry.tsx \
  --props=.launchclip/story.resolved.json --public-dir=.
```

Treat Studio as the review surface. Its Render button creates an ad hoc
render; it is not the user's approval signal or this workflow's final
artifact. Props edited in Studio's sidebar are not saved to `storyboard.json`;
carry any accepted change back into `storyboard.json` and re-resolve.

If the user edits the project, rerun `launchclip story validate`,
`launchclip layout-check`, and fresh stills before requesting approval. Pause
until the user explicitly approves the checked Studio state. If a repair
changes that state, refresh Studio and obtain fresh approval. Do not publish
the project as part of this workflow.

## Render and verify

### Recommended: one command with `launchclip finish`

When the LaunchClip CLI is installed, finish the project in one command
instead of running the steps below by hand:

```bash
launchclip finish <project> --renderer remotion --quality draft   # renders/draft.mp4
launchclip finish <project> --renderer remotion --quality high    # renders/final.mp4, after approval
```

It synthesises `audio.narration` when set (see "Narration" below;
`--voice kokoro|elevenlabs|supplied|test` overrides its provider),
validates and layout-checks the storyboard, writes captions, builds the SFX
and music mix from the hits, module cues, scene energy and the beat-synced
music (`--music synth|elevenlabs|none`), renders, masters to
−14 LUFS / −1 dBTP, builds the temporal evidence and critic sheets, and runs
the motion, audio, loudness, layout and evidence gates. It never rewrites
`storyboard.json` (the filled copy is `.launchclip/finish/storyboard.json`),
skips stages whose inputs have not changed, and writes `finish.json`. The
critic gate stays `pending`: run the fresh-context critic on
`qa/critic-sheets/`, then `launchclip cinematic-check`.

#### Second pass: re-render one scene

The render stage caches the timeline in segments (each scene's body and each
transition overlap), hashed from everything that can change their pixels, in
`.launchclip/finish/segments/remotion/`. After an edit, a plain `launchclip
finish` re-renders only the segments of the scenes you changed and reports how
many it reused and the time saved. For a fix:

```bash
launchclip finish <project> --preview-scene s3   # fast look: renders/scene-s3.mp4 only
launchclip finish <project> --scene s3           # re-render s3 into the final
```

`--preview-scene` renders just that scene with its slice of the soundtrack and
touches neither the final nor the gates. `--scene s3[,s4]` forces those scenes'
segments to re-render, re-runs master, evidence and gates, and writes
before/after stills to `qa/finish/scenes/<id>-before-after.png`: inspect them.
The joined result is frame-identical to a fresh full render.

#### Narration: `audio.narration`, `launchclip voice`, then word anchors

For a synthesised voice, write the script into `storyboard.json` and let
`finish` produce the voice and its word timings. Do not hand-write
`audio.voice` or `audio.words` for a synthesised take:

```json
"audio": {
  "narration": {
    "text": "Your launch stalled at the last step. Here is why.",
    "provider": "kokoro",
    "voice": "af_heart",
    "speed": 1.2
  }
}
```

| field | required | default | notes |
| --- | --- | --- | --- |
| `text` | yes | | The whole script, at most 4000 characters. Sentences end in `.`, `!` or `?`. |
| `provider` | no | `kokoro` | `kokoro` (local, free), `elevenlabs` (paid, needs `ELEVENLABS_API_KEY` and the user's approval), `supplied` (audio you already have in `audio.voice`), `test` (offline placeholder tone). |
| `voice` | no | `af_heart` for Kokoro | The provider's voice id. |
| `speed` | no | `1.2` for Kokoro, else `1` | 0.5 to 2. Speed is a generation parameter, not a time-stretch, so change it to fit a target length. |
| `lines` | instead of `text` | | Dialogue: `[{speaker, text, gap?}]`. `speaker` is a cast id (that character's `voice`) or `"narrator"` (this `voice`). Each line is its own take and every word keeps its `speaker`. |
| `gap` | no | `0.3` | Dialogue only: seconds of pause from the end of one line's speech to the start of the next (0 to 3). Each take is trimmed to its speech, so this is the whole pause; the default keeps a conversation moving, 0.5 or more reads as a beat. A line's own `gap` sets the pause after that line, for a beat that needs to land. |

`finish` synthesises the take into `assets/audio/narration.wav` and
`NARRATION.json` (`launchclip.narration.v1`: the text, provider, voice, speed,
`duration_seconds` and every word's `start`/`end`), then uses it for word
anchors, captions, ducking and beat sync. `finish --voice <provider>`
overrides `provider` for one run. Takes are cached in `.launchclip/voice` by
text, provider, voice and speed, so an unchanged script is never synthesised
twice.

Work in this order:

1. **Write the narration text first**, in `audio.narration`, before any
   scenes (`"scenes": []` is fine at this point). Then run
   `launchclip script check storyboard.json --brief brief.md` (the brief is
   the prompt, notes and transcripts you wrote from; add `--format`, `--goal`
   and `--awareness` from your script plan) and fix every error: a
   script longer than the duration allows, a figure, quote, rating or
   deadline that is not in the brief, a greeting or long first sentence, no
   single call to action at the end, a sentence over 25 words. Treat its
   warnings as an editor's notes.
2. **Measure it:** `launchclip voice <project>` (or
   `launchclip voice --text "..." --voice kokoro --speed 1.2` without a
   project). It synthesises the take (cached), writes `NARRATION.json`, and
   prints the duration, word count, words per minute and one row per sentence
   with its start, end and first-word anchor (for a dialogue story,
   `audio.narration.lines`, one row per line with its speaker; each line is
   voiced in its speaker's voice and `finish` reuses those takes). Adjust the
   text or `speed` and
   rerun until the duration fits the target; never guess the length from a
   word count.
3. **Size the scenes to the real take:** set `format.duration` to the
   measured duration plus a short tail (about 0.3 to 0.8 s), and give each
   beat the span of its sentences.
4. **Anchor scenes and hits to words, not seconds:** `"start": "word:stalled"`,
   `"at": "word:twelve"` (`word:<text>#2` for the second occurrence). Anchors
   survive a re-take; seconds do not.
5. **Run `finish`.** It reuses the measured take and fails validation if an
   anchor names a word that is not in the narration.

If you change the text, rerun `launchclip voice` before moving scenes, then
check that every anchor still resolves with `launchclip story validate`.

#### Music and beat sync in `launchclip finish`

`finish` picks the music: `--music synth|elevenlabs|none`, then
`audio.music`, then ElevenLabs when `ELEVENLABS_API_KEY` is set (the CLI reads
`.env` from the working directory, the project directory and each parent up to
the repo root, without overriding the shell), else the license-free synth bed.
If `finish` warns that ElevenLabs was asked for but the key is not set, it
used the synth bed: stop and fix the key rather than shipping that mix. `audio.music` takes `"synth"`,
`"none"`, an `assets/` path, or
`{provider: "elevenlabs" | "synth" | "file", prompt?, bpm?, file?, sync?: "auto" | "off" | "cuts" | "hits"}`.

- **ElevenLabs is paid.** Use it only when the user has approved spending on
  their account. The request comes from the story: tone, target BPM, the
  scene-energy arc (as a composition plan with one section per energy segment)
  and no vocals. The length is whole bars at the target BPM plus a tail, and
  every section boundary snaps to a bar line, so nudging a cut by less than
  half a bar maps to the same request. Every generation is cached by request
  under `$LAUNCHCLIP_CACHE/elevenlabs/music`.
- **The music lock.** After the first generation, `finish` writes
  `.launchclip/music-lock.json` (request hash, the track copied to
  `.launchclip/music/`, BPM, and the *music brief* that produced it) and
  reuses that track while the brief is unchanged. The brief is the provider,
  model, `audio.music.prompt`, target BPM, style-pack music hints, seed,
  narrated or not, and a length bucket (the track must cover the story plus
  1 s and run at most 8 bars past it). Scene timing, words and module edits
  are not part of it: they only re-run beat sync and alignment against the
  locked track. So **iterate freely on everything except the music brief**;
  changing the brief (or scene energies you want the music to follow: pass
  `--music-regenerate` then) is a new paid generation.
- **Read the music line `finish` prints.** `music: REUSE locked ...` or
  `music: REUSE cached ...` costs nothing; `music: PAID ElevenLabs generation
  of N s (about $X) (reason)` spends credits and says why (no lock yet, which
  brief field changed, the story outgrew the track, or
  `--music-regenerate`). If you did not expect `PAID`, stop before the next
  run and find out why. Output terms depend on the user's ElevenLabs plan
  (see `THIRD_PARTY_NOTICES.md`).
- **Set energy honestly** (calm intro, `"build"` before the payoff, 3 on the
  payoff): it drives both the bed and the ElevenLabs sections.
- **Beats.** The track's BPM, beats and downbeats are measured into
  `BEATS.json` (`launchclip.beats.v1`), so `beat:n` / `downbeat:n` anchors
  resolve against the real music. A hand-written `BEATS.json` is never
  overwritten.
- **Beat sync follows the lane.** Narrated: the music's start offset (and a
  tempo change of at most 3%) is chosen so downbeats land on the first cut
  after the hook, the payoff/CTA start and strong hits; story time never
  changes. Motion (no narration): second-timed cuts snap to the nearest
  downbeat and hits to the nearest beat within 0.25 s, each move re-checked
  against its module and layout-check, and reverted when it breaks one.
  Word anchors never move off their word.
- **Check `qa/beat-sync.json`:** requested vs measured BPM, the offset and
  tempo, every key moment's distance to its downbeat, and each change,
  fallback and skip. Plan cuts on bar lines (bar = 4 × 60 / BPM s) so fewer
  of them need to move.

To keep editing in Final Cut Pro, Premiere Pro or DaVinci Resolve after
finish, export an editable timeline (base clips with their in points, each
overlay scene as an alpha clip, voice, music, per-cue SFX, captions and
markers): `launchclip export <project> --format fcpxml|premiere|edl|otio|all`.
See [finishing-in-an-nle.md](finishing-in-an-nle.md).

Use the manual commands below when the CLI is not available or a single step
needs rerunning with different options.

### Manual render

Draft renders, used for evidence and the critic, keep delivery geometry:

```bash
cd <project>
npx remotion render kit/remotion/entry.tsx LaunchclipStory renders/draft-raw.mp4 \
  --props=.launchclip/story.resolved.json --public-dir=. \
  --codec=h264 --crf=23 --concurrency=50%
node <skill>/scripts/master-loudness.mjs renders/draft-raw.mp4 renders/draft.mp4
```

Render the final from the CLI only after approval, then master it:

```bash
npx remotion render kit/remotion/entry.tsx LaunchclipStory renders/final-raw.mp4 \
  --props=.launchclip/story.resolved.json --public-dir=. \
  --codec=h264 --crf=16 --pixel-format=yuv420p --image-format=png \
  --audio-codec=aac --audio-bitrate=256k
node <skill>/scripts/master-loudness.mjs renders/final-raw.mp4 renders/final.mp4
```

Verify the artifact rather than relying only on the renderer exit code:

```bash
test -s <project>/renders/final.mp4
ffprobe -v error \
  -show_entries format=duration,size:stream=codec_type,codec_name,width,height \
  -of json \
  <project>/renders/final.mp4
```

Compare duration and dimensions with `BRIEF.md` and `storyboard.json`. Confirm
whether audio is present or intentionally absent. Never upload or publish the
output without a separate explicit request.

## Known failure modes and repairs

| Symptom | Cause | Repair |
| --- | --- | --- |
| Motion jumps, freezes, or differs between Studio scrubbing and the render | Animation state in `useState`/`useEffect`/refs, or a CSS transition | Derive the value from `useCurrentFrame()` with `motion.mjs` |
| Two renders of the same props differ | `Math.random()`, `Date.now()`, or iteration over unordered data | Use `random("<seed>")` and stable ordering |
| First frames show a fallback font, or text reflows mid-shot | Font not loaded before rendering, or a custom composition skips `ensureFonts` | Call `ensureFonts(story.brand)` from `kit/remotion/fonts.ts`; for other faces, `delayRender` until `FontFace.load()` resolves |
| Bundling fails with `Can't resolve '@fontsource/…'` | The bundled font packages are not installed | Run the `npm install` command under [Scaffold without a skill pack](#scaffold-without-a-skill-pack) |
| `delayRender() … was not cleared after 28000ms` | A missing `continueRender`, a 404 asset, or a slow font download | Fix the asset path, always settle the handle, use local fonts; raise `--timeout` only for genuinely slow assets |
| `staticFile()` 404 or a black media panel | Leading slash, path outside the project, or an asset not copied under `assets/` | Use `assets/…` paths, run from the project, keep `--public-dir=.` |
| Renders are slow and the bundle is huge | `node_modules` (or old renders) inside the public directory | Install the toolchain in the parent directory; keep large scratch files out of the project |
| Media pops in late or flashes at a scene start | Scene not premounted | Keep `premountFor={fps}` on the scene `<Sequence>` |
| Video drifts from narration or stutters | Variable-frame-rate source, raw `<video>`, or a changed `playbackRate` | Transcode to constant `format.fps`; use `<OffthreadVideo>`; leave the rate alone |
| Narration plays twice | An unmuted video or a per-scene `<Audio>` | Mute every video; keep the single root mix |
| Output ends early, or audio is cut | `format.duration` disagrees with the mix or the last scene | Make `format.duration`, the last scene's `end`, and the mix length agree, then re-resolve |
| Scenes start progressively earlier than storyboard times | A hand-built `TransitionSeries` shortening the series | Use `StoryComposition`, or correct durations from absolute scene times |
| Blank frame or pop inside a transition | A gap of more than 0.1 s between the outgoing and incoming track-0 scenes, so the kit cannot hold the outgoing plate | Make the outgoing `end` meet the incoming `start`; the kit holds it through `in.dur` |
| A "Missing module" box in a frame | The scene's module is unknown, its params are invalid (the box says why), or it has no Remotion component yet | Fix `module`/`params`, or use a catalogue module that has a component |
| Changes in `storyboard.json` do not appear | Stale `.launchclip/story.resolved.json` | Re-run validation and the resolver before every still, preview, or render |
| Captions drift or miss words | `captions.json` built from an old `NARRATION.json` | Regenerate captions with `word-captions.mjs` and re-resolve |
| `Version mismatch` warning, or Studio crashes on start | Mixed Remotion package versions | Reinstall every Remotion package at exactly 4.0.536 |
| Chrome or browser launch errors | Chrome Headless Shell missing or blocked | Run `npx remotion browser ensure`; check sandbox permissions |
| `layout-check` collision or safe-zone failure | A rectangle, scene time, or caption band overlaps | Change `params.rect` or the scene time; never relax the check |
| Blur never resolves at settle | Constant `filter: blur()` | Drive blur from velocity with `motionBlurPx()` so it reaches zero |
