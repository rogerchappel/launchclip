# ShipMode: from one idea to a local video

Build an original eight-second, 1280×720 motion graphic with LaunchClip's
HyperFrames runtime. Learn frame design, seekable timing, semantic reveals,
visual inspection, and local export before adding production automation.

This lesson uses no model, voice, image, music, or cloud-render API. It is silent
by design. Your agent subscription and local compute still have their ordinary
costs. Initial package/browser downloads need network access; the composition
uses local GSAP, bundled Inter, and original HTML/CSS artwork.

## Setup from this repository

Use Node.js 22 or newer, npm, FFmpeg/ffprobe, and a HyperFrames-compatible
Chromium browser. Use the PR branch/commit until this module is released;
it is not present in the already-published LaunchClip 0.1.1 package.

```bash
git clone https://github.com/rogerchappel/launchclip.git
cd launchclip
git switch codex/shipmode-beginner-module
# For a frozen classroom version, checkout the reviewed commit instead.
cd courses/shipmode
npm ci --ignore-scripts
npm run setup
export HYPERFRAMES_NO_TELEMETRY=1
npm run doctor
npm run check:starter
npm run dev:starter
```

On the tested Mac, set the existing Chrome paths shown in
[VALIDATION.md](VALIDATION.md) before running browser commands.

Read `doctor`'s JSON `ok` and browser details: its exit code alone is insufficient.
If a browser is absent, follow the pinned runtime's `npx --no-install hyperframes
browser --help` and approved browser installation instructions. Do not download
an arbitrary executable. `npm run setup` only copies the installed GSAP file
into each project's local `assets/` directory; it makes no network/provider call.
`--ignore-scripts` prevents install lifecycle execution; setup is explicit.

The standalone lesson has its own lockfile and only HyperFrames/GSAP direct
dependencies. Installing the whole LaunchClip repo additionally installs its
legacy Remotion/React/Three stack; that is unnecessary for the first exercise.
Both the lesson and LaunchClip pin HyperFrames **0.7.58**. The standalone
lesson overrides transitive `adm-zip` to **0.6.1** and `sharp` to **0.35.4**
to address known advisories; use its lockfile rather than the root install. Do not substitute
`@latest` in classroom commands; evaluate upgrades as a separate change.

## First exercise (30–45 minutes)

1. Open `starter/index.html`. Find the eight-second root, CSS frame, three cards,
   paused GSAP timeline, and `window.__timelines.main` registration.
2. Make the promise your own. Keep the headline short and preserve readable
   card labels. Use original copy rather than a claim about an untested product.
3. Replace opacity-only card reveals with a 28px vertical entrance that settles
   at `y: 0`. Use `power3.out`, not a repeating bounce.
4. Reveal Idea, Plan, and Clip at 0.3, 2.3, and 4.3 seconds. Move each arrow
   independently, after the receiving card begins. Preserve the eight-second
   progress rail: it expresses elapsed time during reading holds.
5. Run `npm run check:starter`. Inspect frame zero, reveal midpoints, and the
   last frame in Studio. Keep cards on canvas and leave enough time to read.
6. Review and approve your edit locally, then run `npm run render:starter`.
   The result is `starter/renders/shipmode.mp4`.

`starter/` is already renderable; your task improves its motion. `finished/` is
the worked answer, not a cinematic production template. Compare the timeline
code after trying the exercise. Both versions include executable motion sidecars
that check reveal deadlines, ordering, and card containment.

## Worked answer / stable classroom commands

Run these from `courses/shipmode`:

```bash
npm ci --ignore-scripts
npm run setup
export HYPERFRAMES_NO_TELEMETRY=1
npm run check
npm run snapshot
npm run dev
# After reviewing the finished example:
npm run render
ffprobe -v error -show_entries format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate -of json finished/renders/shipmode.mp4
```

`check` targets `finished/`, uses strict warnings and 17 samples plus tween
boundaries; `snapshot` samples 0, 1, 3, 5, and 7.9 seconds. `render` produces a
local draft-quality MP4 at 30fps with one browser worker. It is deliberately
small and silent; no audio stream is expected. Inspect actual pixels as well as
check results. Generated assets, snapshots, browser caches, and renders are
ignored and must not be redistributed as unexplained source files.

## Use an agent without model API billing

After the basic exercise, the beginner agent default is LaunchClip's bundled
`launchclip-create-video` skill. From a prepared LaunchClip source checkout:

```bash
node ./bin/launchclip.js skills install --agent codex --skill launchclip-create-video
# Or: --agent claude
```

Invoke `$launchclip-create-video` in Codex or `/launchclip-create-video` in Claude
Code. Example instruction: “Create an original local HyperFrames explainer from
my brief using supplied assets and the subscription workflow. Use no metered
model or media APIs. Inspect the draft and stop for my render approval.”

This full skill adds concept/story/narration planning and cinematic QA. The
small motion lab does not satisfy or bypass its full cinematic contract. See
[the skill](../../skills/launchclip-create-video/SKILL.md) for its requirements.
The installer writes personal skill links; local links do not install a skill
into a remote account. You can also point a capable agent directly at the file.

`launchclip produce` is an optional later API-backed lesson. A ChatGPT/Codex/
Claude subscription login is not an API key. `--no-audio` still makes model
calls; `--fast-eval` is not free mode; free OpenRouter routing still needs an
account and does not make optional audio providers free. Do not put credentials
or paid runs in the first lesson.

## Suggested dedicated module sequence

1. Evidence and brief: one honest promise, audience, format, original materials.
2. Static frame: type hierarchy, spacing, contrast, safe regions.
3. Motion lab: paused seekable timelines, reveal order, easing, reading holds.
4. Continuity: object identity, meaningful transitions, boundary snapshots.
5. Supplied narration and sound: actual timings, rights, root-owned playback.
6. QA and export: browser checks, real pixels, repair, approval, stream probing.
7. Optional orchestration: LaunchClip intake, planning, assembly, costs, receipts.

Classroom writers should link this module and its tested commit, use the stable
commands above, and describe the API-backed lane as optional. Nothing here
uploads to a school/community, publishes media, or grants posting permission.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| `gsap is not defined` / local asset 404 | Run `npm ci --ignore-scripts`, then `npm run setup` from this directory. |
| Browser missing or cannot launch | Read `npm run doctor`; use a supported existing browser or the approved pinned-runtime installer. Do not replace a browser failure with model repair. |
| Network error during installation | Retry the locked install when registry access is available; no API keys are needed. |
| Permission error in caches | Set an explicit writable npm/browser cache; do not change personal profiles or use `sudo`. |
| Overlap/contrast/containment finding | Inspect the reported selector/time, shorten copy or adjust geometry, rerun check. Do not disable the gate to hide a defect. |
| Frozen or missing animation | Keep one synchronous paused timeline registered under `main`; do not call `play()`, timers, random functions, or fetch. |
| Black render but correct snapshot | Keep the full-frame background on `.canvas`, a sized root child; probe and inspect the real MP4. |
| Output has no sound | Expected for this lesson. Narration/music are later modules. |

See [VALIDATION.md](VALIDATION.md) for the exact tested environment and limitations,
and [ASSETS.md](ASSETS.md) for original material and dependency licensing.
