# Standalone HyperFrames Runtime Contract

Use this reference without relying on an installed HyperFrames plugin or skill
pack. HyperFrames renders a deterministic HTML composition into video.

## Contents

- [Prerequisites](#prerequisites)
- [Scaffold without the skill pack](#scaffold-without-the-skill-pack)
- [Composition contract](#composition-contract)
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
npx hyperframes doctor --json
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
HYPERFRAMES_SKIP_SKILLS=1 npx hyperframes init <project> \
  --non-interactive \
  --example blank \
  --resolution <portrait|square|landscape>
```

Preserve the generated project metadata. Keep planning files at the project
root, approved media under `assets/`, reusable scene files under
`compositions/`, and renders under `renders/`.

## Composition contract

Author the top-level `index.html` as a standalone composition:

- Put one visible root element directly in `<body>` with
  `data-composition-id`, `data-duration`, `data-width`, and `data-height`.
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

For modular scenes, each file in `compositions/` must wrap its root in a
`<template>`. Put its styles and scripts inside that template. The host slot's
composition id, the inner root id, and its timeline key must match exactly.

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
npx hyperframes lint <project> --json
```

Then run the browser, layout, motion, contrast, and snapshot gate:

```bash
npx hyperframes check <project> --json --snapshots --at-transitions
```

Inspect the resulting PNG overview and finding crops with the available image
viewer. Check first, midpoint, transition-boundary, and final frames for:

- clipped, overflowing, tiny, or unreadable text
- accidental overlap or platform-unsafe placement
- missing or black media panels
- blank or static scenes
- weak hierarchy, repetitive layouts, or generic filler
- discontinuities between adjacent scenes

Do not use layout allow-attributes unless the overlap, occlusion, or overflow is
deliberate and documented in the storyboard.

For modular projects, snapshot the midpoint of every hosted scene as a separate
visual smoke test:

```bash
npx hyperframes snapshot <project> --at <comma-separated-midpoints>
```

## Preview and approval

After all gates and snapshot inspection pass, open the editable Studio:

```bash
npx hyperframes preview <project>
```

Pause before rendering. The user must explicitly approve the reviewed preview.
Do not publish the project as part of this workflow.

## Render and verify

Render only after approval:

```bash
npx hyperframes render <project> \
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
