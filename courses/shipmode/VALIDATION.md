# ShipMode validation — 2026-10-02

Validated locally on the course PR branch. See the PR head and remote CI
status before selecting a frozen classroom commit. The published LaunchClip
0.1.1 package does not yet include this module.

## Tested toolchain

- macOS 26.6.2 (25G83), Apple M4 arm64.
- Node 25.8.0, npm 11.11.0; declared minimum Node 22, other versions untested here.
- HyperFrames 0.7.58 in both the root and standalone lesson locks; GSAP 3.14.2.
- FFmpeg/ffprobe 8.0.1; existing Google Chrome 154.0.8037.93.
- Browser checks use an isolated headless profile, not the user's interactive browser.

For the tested Mac with Chrome already installed, set these before checks,
snapshots, and renders (replace the path on another platform):

```bash
export HYPERFRAMES_NO_TELEMETRY=1
export HYPERFRAMES_BROWSER_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export PRODUCER_HEADLESS_SHELL_PATH="$HYPERFRAMES_BROWSER_PATH"
```

Then follow [README.md](README.md). Both root and standalone
`npm ci --ignore-scripts --no-audit --no-fund` installs passed on this machine;
`npm run setup` passed. No model/media API credentials or calls were used.

## Verified results

| Check | Result |
| --- | --- |
| Root `npm run release:check` | 498 tests passed, 0 failed/skipped; legacy smoke and package smoke passed |
| Final `npm run package:smoke` | Passed; 135 packed files, required course sources present, generated files excluded; fresh course install/setup from tarball passed |
| Course clean install and setup | Passed with final lockfile and overrides |
| `npm run check:starter` | Strict lint/runtime/motion pass, 0 layout issues across 32 samples, 52/52 contrast checks pass |
| `npm run check` | Strict lint/runtime/motion pass, 0 layout issues across 40 samples, 52/52 contrast checks pass |
| `npm run snapshot` | Six frames including requested 0, 1, 3, 5, 7.9 seconds plus runtime end sample; local contact sheet produced |
| `npm run render:starter` / `npm run render` | Both pass with `--strict-all`; actual MP4s decoded and inspected |
| Final course `npm audit --omit=dev` | 0 vulnerabilities |
| `git diff --check` | Passed |

Both outputs are H.264, 1280×720, 30 fps, 240 frames, exactly 8.000 seconds,
with no audio stream. Decoded frame inspection at the opening, reveal/hold
points and last frame confirmed readable copy, sequential cards/arrows, the
progress rail, and no clipping/black frames. Post-override renders have the
same SHA-256 as the inspected outputs:

- Starter: `4549a59b2ffdb35cbb04222f04ec1f047172a503897b766dad51afe71df3840a`
- Finished: `8d9180ba761e4a9e836f64096defa579e597c948f5196dee2a42467a0f1ed45e`

No interactive Studio session was opened on this host; `dev` commands are
provided for learner review but were not UI-tested here. Automated checks,
snapshots and renders used isolated headless Chrome. No paid API calls were
made. Snapshot's optional Gemini description was skipped without a key.

## Readiness limits

`npm run doctor` returns JSON `ok: false`: a newer HyperFrames version exists,
optional transcription/TTS/music tools are absent, and Docker is absent.
Node, CPU, RAM, disk, Chrome, FFmpeg and ffprobe checks pass. Those missing
optional tools are not required by this silent local lesson. Do not equate the
doctor process exit code with an all-green environment.

## Dependency audit and scope

The final standalone `npm audit --omit=dev` reports **0 vulnerabilities** after
exact course-only overrides to `adm-zip@0.6.1` and `sharp@0.35.4`. Both support
the declared Node floor. HyperFrames itself stays pinned at 0.7.58; its declared
ranges (`adm-zip ^0.5.16`, `sharp ^0.34.5`) do not select these fixes unaided.
Use the lesson's own lockfile. Do not delete the overrides during an install.

Before the overrides, the course audit reported 3 high-severity affected package
entries, not 3 distinct flaws: two vulnerable production dependencies and their
parent `hyperframes`. There were 10 unique advisory records:

- `hyperframes → adm-zip@0.5.18`: eight records involving archive allocation,
  decompression limits, symlink overwrite, permission bits, duplicate entries,
  async size checks and error handling. Representative advisory:
  [GHSA-7q85-xj36-vmfc](https://github.com/advisories/GHSA-7q85-xj36-vmfc).
- `hyperframes → sharp@0.34.5`: two records covering inherited libvips and libheif
  vulnerabilities ([libvips](https://github.com/advisories/GHSA-f88m-g3jw-g9cj),
  [libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)).

These are runtime dependencies, not dev-only findings. HyperFrames imports
`adm-zip` for project archives and downloaded Lottie parsing; this exercise
imports neither. `sharp` is used for contact sheets and image processing; this
exercise processes its own locally generated PNGs and does not consume HEIF or
untrusted media. Limited exposure is not treated as a fix: patched versions are
installed and the actual snapshot/render workflow is revalidated.

The separate, unchanged **root** dependency lock still audits with 11 affected
entries (7 high, 4 moderate), spanning more than this lesson's two packages.
A full-stack dependency update and its regression testing should be a separate
change; installing the root is unnecessary for the beginner lab. A green course
audit is not a clean bill of health for the root package. Audit results are a
point-in-time advisory check, not a guarantee against all vulnerabilities.

This is an original, silent motion exercise. It does not validate paid-provider
integration, narration, other operating systems, Docker reproducibility, or the
full subscription skill's cinematic contract. Locked installs make source
setup repeatable; browser/OS-dependent rendered bytes are not promised identical.
