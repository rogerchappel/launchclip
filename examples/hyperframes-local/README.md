# Local HyperFrames example

A minimal, original eight-second HTML/GSAP composition showing a paused,
seekable timeline, ordered reveals, motion assertions, and local MP4 export.
It is silent and uses no model, voice, image, or music API. It is not a complete
example of LaunchClip's cinematic production workflow.

## Run

Requires Node.js 22+, npm, FFmpeg/ffprobe, and a HyperFrames-compatible Chromium
browser. From this directory:

```bash
npm ci --ignore-scripts
npm run setup
export HYPERFRAMES_NO_TELEMETRY=1
npm run check
npm run snapshot
npm run dev
# After inspecting the preview:
npm run render
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,avg_frame_rate -of json renders/example.mp4
```

On the tested Mac, an existing Chrome installation was selected with these
settings before the browser commands:

```bash
export HYPERFRAMES_BROWSER_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export PRODUCER_HEADLESS_SHELL_PATH="$HYPERFRAMES_BROWSER_PATH"
```

For other hosts, run `npx --no-install hyperframes doctor --json` and inspect
its JSON checks. Use a compatible installed browser or the pinned runtime's
browser installer. Initial dependency/browser downloads need network access.
`setup` only copies the installed GSAP bundle locally, retaining its notices.
Do not commit generated assets, snapshots, or renders.

HyperFrames **0.7.58** matches LaunchClip's pin; GSAP is **3.14.2**. Use this
example's own lockfile: `adm-zip` **0.6.1** and `sharp` **0.35.4** overrides fix
known transitive advisories without upgrading HyperFrames. Installing the full
LaunchClip dependency stack is unnecessary for this example.

## Verification and limits

Tested on macOS arm64, Node 25.8.0, Chrome 154 and FFmpeg 8.0.1. Strict checks,
snapshots and actual render/decoded-frame inspection pass: H.264, 1280×720,
30 fps, 240 frames, eight seconds, no audio. Interactive Studio and rendering
on other platforms were not tested. Doctor flags the older runtime version,
absent optional audio tools and Docker; these are not needed for this example.

The standalone `npm audit --omit=dev` reports zero vulnerabilities as of
2026-10-02. The separate root lock still reports 11 affected entries; this
example's overrides do not remediate the root stack. Do not infer a general
security guarantee from a point-in-time audit.

## Materials and licensing

HTML/CSS artwork and copy are original and covered by the repository's
[MIT license](../../LICENSE). There is no third-party footage, audio, logo or
likeness. The runtime embeds Inter (SIL Open Font License); no font file is
committed here. HyperFrames declares Apache-2.0. GSAP's installed `package.json`
references its [Standard No Charge license](https://gsap.com/standard-license/),
not MIT or a bundled `LICENSE` file. Preserve GSAP's proprietary notices and
review its terms before redistribution or reuse in a visual animation builder.
See also [third-party notices](../../THIRD_PARTY_NOTICES.md).
