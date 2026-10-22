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
  `@remotion/transitions@4.0.536`, `@remotion/google-fonts@4.0.536`,
  `react@19.3.1` and `react-dom@19.3.1`
- network access for the first `npm install` and Chrome Headless Shell
  download only; rendering itself needs none when fonts are local

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
  @remotion/transitions@4.0.536 @remotion/google-fonts@4.0.536 \
  react@19.3.1 react-dom@19.3.1
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
- `audio.mix` names the one offline mix; `overlays` holds captions; `ending`
  can loop to a scene.
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
- Typed boundaries through `@remotion/transitions`: `fade` → `fade()`, `push` →
  `slide()`, `iris` → `iris()`, `whip` and `zoom` → the kit's custom
  presentations, `cut` → no transition, and `morph` → no boundary effect, with
  the modules handing the shared object across. A `TransitionSeries`
  transition overlaps both neighbours and shortens the series by its length;
  the kit compensates from absolute scene times, so story times stay
  authoritative. Do not hand-build a `TransitionSeries` against story times
  without the same correction.
- Exactly one `<Audio src={staticFile(story.audio.mix)} />` at the root, spanning
  the whole composition. No scene, module, or video plays its own audio.
- Captions from `assets/captions/captions.json` through the kit's
  `<WordCaptions>`, mounted once on the top layer for the full duration.
- The loop ending, when `ending.loop_to` is set, returns to that scene's frame
  zero state on the last frame.

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
- Load fonts before the first frame. Use `loadFont()` from
  `@remotion/google-fonts/<Family>` at module top level with explicit
  `weights` and `subsets`, or package files under `assets/fonts/` and block
  rendering until they load:

```tsx
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

const fontHandle = delayRender("Load display font");
const display = new FontFace("Display", `url(${staticFile("assets/fonts/Display.woff2")}) format("woff2")`);
display.load()
  .then(() => { document.fonts.add(display); continueRender(fontHandle); })
  .catch((error) => cancelRender(error));
```

`@remotion/google-fonts` downloads from Google at render time; prefer local
files when the render host is offline or the brief requires a frozen font.
Every `delayRender()` must reach `continueRender()` or `cancelRender()`.

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
  that receives `{scene, params, brand, format}`, where `params` is
  `scene.params`. Set the scene's `module` to `"custom"` and
  `params.component` to `<name>`.
- Register it through `remotion/entry.tsx`, which renders the kit's
  `StoryComposition` with a `customModules` map
  (`{ "<name>": Component }`) under the same `LaunchclipStory` id and
  metadata. Leave every kit file unmodified.
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
- The first frame must already communicate an intentional state. The first
  second states the promise. The first four seconds contain at least three
  meaningful changes in layout, evidence, framing, or visual register for
  portrait, or two for landscape.
- Keep outgoing and incoming shared-world planes alive for the full declared
  transition duration: the outgoing scene's `end` must reach the incoming
  scene's settle. Use one continuous position curve and a velocity-shaped blur
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
| First frames show a fallback font, or text reflows mid-shot | Font not loaded before rendering | `loadFont()` at module top level, or `delayRender` until `FontFace.load()` resolves |
| `delayRender() … was not cleared after 28000ms` | A missing `continueRender`, a 404 asset, or a slow font download | Fix the asset path, always settle the handle, use local fonts; raise `--timeout` only for genuinely slow assets |
| `staticFile()` 404 or a black media panel | Leading slash, path outside the project, or an asset not copied under `assets/` | Use `assets/…` paths, run from the project, keep `--public-dir=.` |
| Renders are slow and the bundle is huge | `node_modules` (or old renders) inside the public directory | Install the toolchain in the parent directory; keep large scratch files out of the project |
| Media pops in late or flashes at a scene start | Scene not premounted | Keep `premountFor={fps}` on the scene `<Sequence>` |
| Video drifts from narration or stutters | Variable-frame-rate source, raw `<video>`, or a changed `playbackRate` | Transcode to constant `format.fps`; use `<OffthreadVideo>`; leave the rate alone |
| Narration plays twice | An unmuted video or a per-scene `<Audio>` | Mute every video; keep the single root mix |
| Output ends early, or audio is cut | `format.duration` disagrees with the mix or the last scene | Make `format.duration`, the last scene's `end`, and the mix length agree, then re-resolve |
| Scenes start progressively earlier than storyboard times | A hand-built `TransitionSeries` shortening the series | Use `StoryComposition`, or correct durations from absolute scene times |
| Blank frame or pop inside a transition | The outgoing scene ends before the incoming one settles | Extend the outgoing `end` through the whole `in.dur` |
| Changes in `storyboard.json` do not appear | Stale `.launchclip/story.resolved.json` | Re-run validation and the resolver before every still, preview, or render |
| Captions drift or miss words | `captions.json` built from an old `NARRATION.json` | Regenerate captions with `word-captions.mjs` and re-resolve |
| `Version mismatch` warning, or Studio crashes on start | Mixed Remotion package versions | Reinstall every Remotion package at exactly 4.0.536 |
| Chrome or browser launch errors | Chrome Headless Shell missing or blocked | Run `npx remotion browser ensure`; check sandbox permissions |
| `layout-check` collision or safe-zone failure | A rectangle, scene time, or caption band overlaps | Change `params.rect` or the scene time; never relax the check |
| Blur never resolves at settle | Constant `filter: blur()` | Drive blur from velocity with `motionBlurPx()` so it reaches zero |
