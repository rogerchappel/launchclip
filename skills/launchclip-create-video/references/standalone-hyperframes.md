# Standalone HyperFrames Runtime Contract

Use this reference without relying on an installed HyperFrames plugin or skill
pack. HyperFrames renders a deterministic HTML composition into video.

## Contents

- [Prerequisites](#prerequisites)
- [Scaffold without the skill pack](#scaffold-without-the-skill-pack)
- [Local source preparation](#local-source-preparation)
- [Composition contract](#composition-contract)
- [Design and motion quality contract](#design-and-motion-quality-contract)
- [Motion sidecar](#motion-sidecar)
- [Verification loop](#verification-loop)
- [Preview and approval](#preview-and-approval)
- [Render and verify](#render-and-verify)

## Prerequisites

- Node.js 22 or newer
- FFmpeg and `ffprobe`
- network access for `npx` only when the HyperFrames package is not cached

Check the host first:

```bash
node --version
ffmpeg -version
npx --yes hyperframes@0.7.58 doctor --json
```

`doctor --json` exits successfully even when the environment is unhealthy;
inspect the JSON `ok` field rather than trusting the exit code.

Set one correlation id for the task:

```bash
export HYPERFRAMES_RUN_ID="launchclip-agent-<slug>"
```

## Scaffold without the skill pack

Map the chosen aspect to a resolution preset: `9:16` to `portrait`, `1:1` to
`square`, and `16:9` to `landscape`.

```bash
HYPERFRAMES_SKIP_SKILLS=1 npx --yes hyperframes@0.7.58 init <project> \
  --non-interactive \
  --example blank \
  --resolution <portrait|square|landscape>
```

Preserve the generated project metadata. Keep planning files at the project
root, approved media under `assets/`, reusable scene files under
`compositions/`, and renders under `renders/`.

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

Trim leading/trailing silence with a small speech handle. Re-encode when a
precise non-keyframe boundary matters; preserve internal pauses:

```bash
ffmpeg -ss <start-with-handle> -to <end-with-handle> -i <input> \
  -c:v libx264 -crf 18 -preset medium \
  -c:a aac -b:a 192k -movflags +faststart \
  <project>/assets/source-trimmed.mp4
```

For narration-led edits, transcribe on the host with a local ASR engine:

```bash
npx --yes hyperframes@0.7.58 transcribe <project>/assets/source-trimmed.mp4 \
  --dir <project> --engine auto --model small.en --json
```

`auto` uses local Parakeet when installed and otherwise local Whisper. Do not
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
  -vn -c:a aac -b:a 192k \
  <project>/assets/heygen-avatar-voiceover.m4a
```

Mount the extracted audio once as a direct child of the top-level composition
root. Mount the prepared avatar video as muted direct-root clips only for the
scenes where the presenter is visible. Each clip's media offset must follow the
continuous narration timeline; do not restart the avatar at every scene. This
allows full-frame graphics during voiceover scenes without interrupting speech
and prevents duplicate audio when presenter layouts overlap at transitions.

Do not leave a HeyGen download URL in the composition, call the HeyGen API, or
request credentials in this workflow. Confirm likeness authorization and the
final spoken script before authoring around the file.

## Composition contract

Author the top-level `index.html` as a standalone composition:

- Put one visible root element directly in `<body>` with
  `data-composition-id`, `data-duration`, `data-width`, and `data-height`.
- Put `data-launchclip-cinematic-contract="phase-2"` on the root for every new
  project authored by this workflow. Do not silently retrofit the marker onto
  a legacy project that has not produced the required phase-2 evidence.
- Give the root an explicit pixel-sized box. A `height: 100%` child is valid
  only when every ancestor has a resolved height.
- Do not wrap the standalone root in `<template>`.
- Mark timed visual elements with `class="clip"`, `data-start`,
  `data-duration`, and an intentional `data-track-index`.
- Register exactly one paused, synchronously constructed timeline at
  `window.__timelines["<composition-id>"]`.
- Make the timeline key exactly match the root composition id.
- Treat root `data-duration` as authoritative; do not infer duration from the
  timeline length.
- Put a full-frame background on an absolutely positioned child, not on the
  composition root.
- Give every assembled DOM id a unique, composition-prefixed value.
- Mark each shared-world plane with `data-launchclip-sequence-id`. Mark every
  declared boundary with `data-launchclip-boundary-id`,
  `data-launchclip-transition-kind="ordinary|shared-world"`,
  `data-launchclip-transition-start`, and
  `data-launchclip-transition-duration`. When an object or plane is handed
  across the boundary, put its stable IDs in `data-launchclip-transition-from`
  and `data-launchclip-transition-to`.

Keep rendering deterministic and seek-safe:

- Do not use render-time clocks, unseeded randomness, input state, live network
  requests, or infinite animation repeats.
- Do not animate `display` or `visibility`; animate opacity and transforms.
- Use finite animation counts and a paused timeline that produces the same
  frame whenever it is sought to the same time.
- Size transformed elements explicitly and keep readable text inside resolved
  containers.
- Avoid `<br>` in body copy; use separate block elements when line structure is
  meaningful.

HyperFrames owns media playback:

- Place `<video>` and `<audio>` as direct children of the top-level composition
  root.
- Do not place media inside a sub-composition template or arbitrary wrapper.
- Use local, approved asset paths. Do not leave provider URLs or expiring URLs
  in the composition.

For presenter-plus-graphic layouts, measure the source focal point and compute
the crop against the target rectangle. Given a source crop
`(u0, v0, u1, v1)`, source dimensions `(sw, sh)`, scale `s`, and target origin
`(tx, ty)`, place the direct-child media at `x = tx - u0*s` and
`y = ty - v0*s`. Express the clip inset as percentages of the untransformed
source: top `v0/sh`, right `(sw-u1)/sw`, bottom `(sh-v1)/sh`, and left `u0/sw`.
This keeps the transformed crop flush with the intended panel instead of
creating a dead band. Recompute the crop when scale or focal point changes.

Place music and cue audio as direct children too. Keep supplied presenter audio
at full program level, start music conservatively around `data-volume="0.10"`
to `"0.18"`, and give each SFX a timed clip whose start matches a visible
event. Resolve provider media to project-local files before preview or render.
When beat alignment is useful, precompute `BEATS.json` locally and author exact
timeline positions from that frozen data; do not perform live audio analysis at
render time.

For modular scenes, each file in `compositions/` must wrap its root in a
`<template>`. Put its styles and scripts inside that template. The host slot's
composition id, the inner root id, and its timeline key must match exactly.

### Compiling a storyboard.json

When the project is authored as a `storyboard.json` (`launchclip.story.v1`),
compile it instead of hand-writing `index.html`:

```bash
launchclip story compile <project> --renderer hyperframes --out <project>/hyperframes
```

Without the CLI, call `compileStoryToHyperFrames(resolvedStory, {projectDir,
sourceDir})` from `scripts/story-compiler.mjs` (resolve the story first with
`resolveStory` from `scripts/story.mjs`). The output keeps this contract: one
root `launchclip-story` composition with one paused timeline, each scene's
module inside a scene layer, typed transitions between track-0 scenes with the
phase-2 boundary attributes, one root `<audio>` from `audio.mix`, word captions,
the loop ending, the brand fonts and ambient motion. Unknown modules render a labelled
placeholder and a compile warning; `launchclip finish` fails its validate stage
on a scene whose params do not resolve and its `placeholders` gate on any scene
that would render as one. Keep the output in its own directory: a
directory holding both `storyboard.json` and `index.html` is read as
HyperFrames. Repair the storyboard and recompile rather than editing the
generated `index.html`.

`motion.grammar` and `camera` (see `storyboard-modules.md`, "Motion grammar
and camera") change only the motion: the grammar's eases, durations and
staggers reach module entrances and exits, pops and typed transitions, and a
world camera (`camera.mode` "world", or a `pan`, `whip-pan`, `orbit` or
`pull` transition in a cuts story) puts every track-0 plate inside one world
container (`#lc-camera` › `#lc-cam-drift` › `#lc-cam-zoom` › `#lc-cam-pan`)
moved by seek-safe `fromTo` tweens and per-frame `tl.set` calls, with a
parallax `#lc-world-bg`, `.lc-parallax` wrappers on overlays and a directional
SVG motion blur that is zero at rest. Root `<video>` media does not follow the
camera, so keep media-window video out of world-camera stories. A story without
either compiles exactly as before.

Ambient motion (`scripts/ambient.mjs`) keeps settled frames moving between
beats, so the piece does not read as a slideshow:

- **Background field.** Each track-0 plate's layer starts with
  `<div class="lc-ambient-field">`: a few large, soft, low-alpha blobs of the
  brand `primary` and `accent` colours. They glide slowly across the canvas,
  wrapping only while off canvas, bob gently and breathe in scale.
- **Hold drift.** Each eligible scene's module output sits in
  `<div id="lc-drift-<scene>" class="lc-drift">`. It pushes in linearly about
  the module rect's centre (scale up to 2–4% plus a few px of vertical travel)
  from the scene start to the end of its render window. The push is clamped to
  the safe zone and kept clear of the caption band; a rect with no room gets a
  small pull-back instead.

Both layers are seek-safe GSAP on the master timeline: `tl.fromTo` with
`immediateRender: false`, `force3D: false` (2D transforms keep text crisp),
linear or `sine.inOut` eases and no `onUpdate`. Remotion evaluates the same
functions per frame, so the renderers stay in parity.

Control it with `story.ambient` (`off | subtle | standard | lively`, or
`{level, background, drift}`) and a per-scene `ambient` override. The
default level follows each scene's `energy` (0 → subtle, 1, 2 and `"build"` →
standard, 3 → lively). The footage-led lane gets no field and drifts overlays
only. Leave it on: with `"off"`, settled frames hold still and the cinematic
motion gate fails. `launchclip layout-check` checks every drifting rect at its
largest extent. Never hand-edit the generated field or drift; change the
storyboard and recompile.

In world mode the plates are transparent, so the one background field moves
at 0.3× behind them inside `#lc-world-bg` instead of once inside every plate;
the hold drift stays inside each plate and composes with the camera drift.

A `footage-led` storyboard adds a `base` recording (`{src, trim | edl, volume,
fit, focus}`; see `recorded-video.md`). The compiler mounts the base as muted
direct-root `<video class="clip lc-base-media">` clips, one per trim segment.
Each clip's `data-media-start` is the segment's source in-point, so the
timeline plays the trimmed recording back to back. The recording's sound is
mounted as matching root `<audio>` clips at `base.volume`, and `audio.mix` is
mounted only as the bed under it. `punch-in` scenes are cameras: their per-frame
spring samples become `tl.set(".lc-base-media", {x, y, scaleX, scaleY})`
calls, which zoom the base toward the focus point without exposing an edge.
Overlays (`footage-callout`, `lower-third`, `emphasis-caption` and any
catalogue module) sit on tracks 1 and up. `insert: true` scenes are track-0
plates that cover the picture while the recording keeps sounding. Resolve
`base.edl` first: `launchclip story compile` and `resolveStory(story, {edl})`
do it, and the compiler warns when a story still carries an unresolved `edl`.

### Fonts

Text renders only from bundled font files, never from Google Fonts or the
host's installed fonts. `scripts/fonts.mjs` is the registry: Anton, Archivo
Black, Bebas Neue, Big Shoulders Display, Bricolage Grotesque, DM Sans, DM
Serif Display, Fira Code, Fraunces, Instrument Serif, Inter, JetBrains Mono,
Lexend, Manrope, Oswald, Outfit, Playfair Display, Plus Jakarta Sans, Sora,
Space Grotesk, STIX Two Math, STIX Two Text, Syne, Unbounded and Young Serif,
each from a pinned `@fontsource` package (OFL-1.1, latin subset). The
compiler:

- loads every role default (display Anton, body Inter, meta JetBrains Mono,
  maths STIX Two Text, quote serif Instrument Serif), STIX Two Math as the
  symbol fallback, and every family `brand.fonts` names;
- copies each registry file into `<out>/fonts/` and declares it with
  `@font-face` (`font-display: block`), then starts every face loading so the
  render's `document.fonts.ready` wait covers text that appears later;
- uses frozen files under `assets/fonts/` instead when they exist for a family,
  named `<family-slug>-<weight>[-italic].woff2` (`poppins-700.woff2`), which is
  how a brand family outside the registry is added;
- warns and keeps the role's bundled family when a family is neither in the
  registry nor frozen.

The compiler resolves the font files from `node_modules`, next to the compiler
first and then next to the storyboard project. Outside the LaunchClip repo,
install the exact packages once in the project:

```bash
npm install --save-exact @fontsource-variable/big-shoulders-display@5.3.0 \
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

A compile warning `font file … is not installed` means that step is missing.

## Design and motion quality contract

Treat `DESIGN.md`, `STORYBOARD.md`, and `QUALITY.md` as executable creative
constraints:

- Use the bundled registry families (see [Fonts](#fonts)), or package exact
  font files under `assets/fonts/` and declare them with `@font-face`. Never
  rely on a font installed on the render host. Use three explicit roles:
  display, body, and metadata. A silent
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
- Simulate motion blur with short-lived directional blur, stretched duplicates,
  or low-opacity ghost layers tied to velocity. Blur must resolve to zero at the
  settle frame so text and UI remain sharp.
- Reserve hard cuts for contrast. Pushes preserve direction, zooms change scale,
  morphs preserve identity, whips create an energetic discontinuity, and masks
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
  transition duration. Use one continuous position curve and a velocity-shaped
  blur envelope: zero blur at departure, strongest near peak speed, and zero at
  settle. Do not remove the outgoing plane before the incoming plane settles.

Prefer a small authored scene grammar over a rigid template: presenter anchor,
presenter-plus-proof split, full-frame diagram, kinetic type reset, evidence/UI
focus, and closing lockup. Reuse the design system, not the same layout.

## Motion sidecar

Create `index.motion.json` so the browser gate can verify authored intent:

```json
{
  "duration": 45,
  "assertions": [
    { "kind": "appearsBy", "selector": "#scene-01-headline", "bySec": 0.6 },
    { "kind": "before", "a": "#scene-01-headline", "b": "#scene-01-proof" },
    { "kind": "staysInFrame", "selector": ".proof-card" },
    { "kind": "keepsMoving", "withinSelector": "#video-stage", "maxStaticSec": 2 }
  ]
}
```

Use selectors that resolve to real elements. Assertions are defects when they
fail; do not delete them merely to make the gate green.

## Verification loop

Run fast static checks after the first authoring pass:

```bash
npx --yes hyperframes@0.7.58 lint <project> --json
```

Then run the browser, layout, motion, contrast, and snapshot gate:

```bash
npx --yes hyperframes@0.7.58 check <project> --json --strict --snapshots --at-transitions
```

Inspect the resulting PNG overview and finding crops with the available image
viewer. Check first, midpoint, transition-boundary, and final frames for:

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

Do not use layout allow-attributes unless the overlap, occlusion, or overflow is
deliberate and documented in the storyboard.

For modular projects, snapshot the midpoint of every hosted scene as a separate
visual smoke test:

```bash
npx --yes hyperframes@0.7.58 snapshot <project> --at <comma-separated-midpoints>
```

Also sample the hook densely and inspect both sides of high-energy transitions:

```bash
npx --yes hyperframes@0.7.58 snapshot <project> \
  --at 0,0.25,0.5,0.75,1,1.5,2,2.5,3,4,<transition-times>
```

View snapshots at delivery size. An overview can hide weak hierarchy, tiny
type, one-frame overlaps, or a blur that never resolves. When a transition is
suspect, snapshot neighboring times in 50-100 ms increments and repair the
timeline rather than accepting the artifact.

For a phase-2 project, build `qa/temporal-evidence/manifest.json` from exact
samples. Clamp every timestamp to the composition duration and deduplicate it:

- hook: `0,0.25,0.5,0.75,1,1.5,2,3,4`
- ordinary boundary: 0.05 seconds before, midpoint, and 0.05 seconds after
- shared-world move: 0.05 seconds before, departure, 20%, 50%, 80%, settle,
  and 0.05 seconds after
- final hold: 0.05 seconds before the composition duration

Also capture useful sequence entry, settled-state, shot-midpoint, and planned
visible-event samples when they add evidence beyond the required schedule.
These supplemental entries are not substitutes for hook, boundary, or
final-hold samples.

Capture both a HyperFrames snapshot and a frame extracted from the encoded
draft for every required sample; the latter proves the delivered artifact
rather than only the browser preview. Use this manifest shape:

```bash
npx --yes hyperframes@0.7.58 snapshot <project> --at <comma-separated-schedule>
ffmpeg -hide_banner -loglevel error -i <project>/renders/draft.mp4 \
  -ss <at-seconds> -frames:v 1 -y \
  <project>/qa/temporal-evidence/<sample-id>-encoded-draft.png
```

`scripts/build-evidence.mjs <project>` does all of this in one step: it
derives the schedule from the declared boundaries, captures both sources,
writes the hashed manifest, and builds paired contact sheets for the critic in
`qa/critic-sheets/` (left tile = browser still, right tile = encoded draft).
Set `HYPERFRAMES_BIN` to a local binary to skip `npx`. To do it by hand instead:

Copy or rename each HyperFrames result to
`qa/temporal-evidence/<sample-id>-browser-still.png`, then hash the current
draft and every evidence file. Older manifests that use the `hyperframes`
source name stay valid. Do not reuse the browser snapshot as encoded-draft
evidence.

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
Additional sequence/event samples are allowed, but they also need unique
evidence IDs, valid files and hashes, and critic review. Fail the review when an
expected source is missing, a file is empty, the current draft hash changed, an
artifact hash is stale, a timestamp is out of range, or the fresh-context
critic did not list every evidence ID it reviewed.

## Preview and approval

After all gates and snapshot inspection pass, open the editable Studio:

```bash
npx --yes hyperframes@0.7.58 preview <project>
```

Treat Studio as the review and editing surface. Its Export action creates an ad
hoc HyperFrames render; it is not the user's approval signal or this workflow's
final artifact.

If the user edits the project in Studio, rerun `hyperframes check --snapshots`
and inspect the new overview before requesting approval. Pause until the user
explicitly approves the checked Studio state. If a repair changes that state,
refresh Studio and obtain fresh approval. Do not publish the project as part of
this workflow.

## Render and verify

### Recommended for storyboard projects: `launchclip finish`

When the project is driven by a `storyboard.json` and the LaunchClip CLI is
installed, finish it in one command:

```bash
launchclip finish <project> --renderer hyperframes --quality draft   # renders/draft.mp4
launchclip finish <project> --renderer hyperframes --quality high    # renders/final.mp4, after approval
```

It synthesises `audio.narration` when set (see "Narration" below;
`--voice kokoro|elevenlabs|supplied|test` overrides its provider),
validates and layout-checks the storyboard, writes captions, builds the SFX
and music mix from the hits, module cues, scene energy and the beat-synced
music (`--music synth|elevenlabs|none`), compiles the
storyboard to `.launchclip/finish/hyperframes/`, renders, masters to −14 LUFS /
−1 dBTP, builds the temporal evidence and critic sheets, and runs the motion,
audio, loudness, layout and evidence gates. It never rewrites
`storyboard.json`, skips stages whose inputs have not changed, and writes
`finish.json`. The critic gate stays `pending` until the fresh-context critic
has reviewed `qa/critic-sheets/`.

`--scene s3` and `--preview-scene s3` work with HyperFrames too, but its CLI
has no frame range, so `--scene` re-renders the whole video (cached by the
hash of the whole timeline, so an unchanged story is never rendered twice).
`--preview-scene` cuts the preview from that cached render when the story is
unchanged since it; otherwise it compiles only the scene's window (a
composition of that stretch, in `.launchclip/finish/hyperframes-preview/`,
whose frames match the whole render's) and renders that, so a preview takes
seconds rather than a whole render. Partial rendering into the final is
Remotion-only.

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

Hand-authored `index.html` projects (no storyboard) use the manual render
below.

### Manual render

Render from the CLI only after approval:

```bash
npx --yes hyperframes@0.7.58 render <project> \
  --quality high \
  --strict \
  --output <project>/renders/final.mp4
```

Verify the artifact rather than relying only on the renderer exit code:

```bash
test -s <project>/renders/final.mp4
ffprobe -v error \
  -show_entries format=duration,size:stream=codec_type,codec_name,width,height \
  -of json \
  <project>/renders/final.mp4
```

Compare duration and dimensions with `BRIEF.md`. Confirm whether audio is
present or intentionally absent. Never upload or publish the output without a
separate explicit request.
