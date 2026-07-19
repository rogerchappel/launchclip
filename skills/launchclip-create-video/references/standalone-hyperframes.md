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

## Design and motion quality contract

Treat `DESIGN.md`, `STORYBOARD.md`, and `QUALITY.md` as executable creative
constraints:

- Package exact font files under `assets/fonts/` and declare them with
  `@font-face`, or use another deterministic family proven available on the
  render host. Use three explicit roles: display, body, and metadata. A silent
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
- The first frame must already communicate an intentional state. The first
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
- each sequence: entry, settled state, shot midpoint, planned visible event,
  and final hold

Capture both a HyperFrames snapshot and a frame extracted from the encoded
draft for every required sample; the latter proves the delivered artifact
rather than only the browser preview. Use this manifest shape:

```bash
npx --yes hyperframes@0.7.58 snapshot <project> --at <comma-separated-schedule>
ffmpeg -hide_banner -loglevel error -i <project>/renders/draft.mp4 \
  -ss <at-seconds> -frames:v 1 -y \
  <project>/qa/temporal-evidence/<sample-id>-encoded-draft.png
```

Copy or rename each HyperFrames result to
`qa/temporal-evidence/<sample-id>-hyperframes.png`, then hash the current draft
and every evidence file. Do not reuse the browser snapshot as encoded-draft
evidence.

```json
{
  "schema_version": "launchclip.subscription-temporal-evidence.v1",
  "video_sha256": "<sha256-of-renders/draft.mp4>",
  "entries": [
    {
      "sample_id": "hook-001",
      "evidence_id": "hook-001-hyperframes",
      "source": "hyperframes",
      "role": "hook",
      "at_seconds": 0,
      "sequence_id": null,
      "boundary_id": null,
      "file": "qa/temporal-evidence/hook-001-hyperframes.png",
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
