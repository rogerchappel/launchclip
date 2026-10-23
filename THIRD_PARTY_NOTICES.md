# Third-Party Notices

LaunchClip's own source code is licensed under the MIT License. Dependencies
installed with LaunchClip remain governed by their respective licences and are
not relicensed under LaunchClip's MIT License.

## Remotion

LaunchClip depends on Remotion 4.0.536 packages for Remotion-based video
rendering, including `remotion`, `@remotion/cli`,
`@remotion/google-fonts`, `@remotion/motion-blur`, `@remotion/three`, and
`@remotion/transitions`.

Remotion 4.0.536 uses the Remotion License. Its installed licence text states
that individuals, non-profit organisations, organisations evaluating Remotion,
and for-profit organisations with up to three employees are eligible for the
free licence; other for-profit organisations require a company licence. The
published metadata for `@remotion/transitions` declares that package
`UNLICENSED`. LaunchClip does not grant rights to Remotion packages beyond the
rights supplied by their publisher.

Review the current terms before use:

- <https://www.remotion.dev/license>
- <https://www.remotion.pro/license>

## Kokoro voice (optional)

The default open-source voice uses `kokoro-js` 1.2.1 (Apache-2.0, by hexgrad
and Xenova), declared as an optional dependency, so installs without it still
work. It runs the Kokoro-82M v1.0 model (Apache-2.0, by hexgrad) through
`@huggingface/transformers` (Apache-2.0) and `onnxruntime-node` (MIT).
LaunchClip does not bundle the model: on first use the ONNX export
`onnx-community/Kokoro-82M-v1.0-ONNX-timestamped` is downloaded from Hugging
Face into `$LAUNCHCLIP_CACHE/kokoro` (default `~/.cache/launchclip/kokoro`).
The voice style vectors ship inside the `kokoro-js` package.

Phonemisation uses the `phonemizer` package (declared Apache-2.0), which is a
WebAssembly build of eSpeak NG. Upstream eSpeak NG is licensed GPL-3.0-or-later;
review its terms before redistributing a bundle that includes it.

- <https://huggingface.co/hexgrad/Kokoro-82M>
- <https://github.com/hexgrad/kokoro>
- <https://github.com/espeak-ng/espeak-ng>

## Playwright (optional, demo autopilot)

Demo autopilot (`launchclip demo record`) drives Chromium with `playwright`
1.64.1 (Apache-2.0, by Microsoft), declared as an optional dependency. It never
downloads a browser: it uses `LAUNCHCLIP_CHROMIUM`, Playwright's pinned build,
the newest Chromium already in the Playwright cache, or a system Chrome, in
that order. Video is encoded by the system `ffmpeg`, not Playwright's ffmpeg
build.

- <https://github.com/microsoft/playwright>

## ElevenLabs voice and music (optional, paid)

The ElevenLabs voice provider and music provider call the ElevenLabs API only
when `ELEVENLABS_API_KEY` is set (for music, `launchclip finish` uses
ElevenLabs by default once the key is set and prints a notice; `--music synth`
or `audio.music: "synth"` keeps the license-free procedural bed). Use of that
service and of its output is governed by the ElevenLabs terms of service and
the plan of the account that made the request, not by LaunchClip's licence.

For generated music (Eleven Music), at the time of writing ElevenLabs states
that:

- free-plan output is not licensed for commercial use and must be attributed
  to "Eleven Music" when distributed;
- paid self-serve plans include a commercial licence for online and offline
  use, with exceptions (such as film, TV and games) reserved for Enterprise
  plans;
- prompts must not name artists, songs, albums or labels.

Check the current terms at <https://elevenlabs.io/terms-of-use> and
<https://elevenlabs.io/music> before you publish or redistribute generated
music. LaunchClip never bundles ElevenLabs output: generated tracks stay in
your project (`assets/audio/music.mp3`) and your local cache
(`$LAUNCHCLIP_CACHE/elevenlabs/music`), and `AUDIO-MANIFEST.json` records the
provider of every track.

## Sound effects

The procedural SFX kit (`skills/launchclip-create-video/scripts/synth-audio-kit.mjs`:
whooshes, impacts, risers, ticks, pops, shimmers, sub drops, UI clicks and
mechanical keystrokes) is original synthesis with local FFmpeg. It contains
no third-party samples and is covered by LaunchClip's MIT License.

`launchclip sfx seed --provider elevenlabs` (opt-in, needs
`ELEVENLABS_API_KEY`) generates library sounds with the ElevenLabs sound
effects API. LaunchClip ships no ElevenLabs audio; generated files stay in the
user's library (`.launchclip/sfx/` or `~/.launchclip/sfx/`), and their use is
governed by the ElevenLabs terms of service for the account that generated
them. `finish` records the source of every cue in `qa/sfx.json` and states
the licence in `AUDIO-MANIFEST.json`.

## Bundled fonts

Both renderers draw text with font files from these packages, pinned to exact
versions and loaded from `node_modules` (latin subset, plus the unsubset STIX
Two Math for symbols). The registry that names them is `kit/core/fonts.mjs`.
Every family is licensed under the SIL Open Font License, Version 1.1
(`OFL-1.1`); each package ships the licence text in its `LICENSE` file. The
font software is not relicensed under LaunchClip's MIT License, and the fonts
may not be sold on their own.

| Family | Package | Copyright holder (from the package LICENSE) |
|---|---|---|
| Anton | `@fontsource/anton@5.3.0` | The Anton Project Authors |
| Archivo Black | `@fontsource/archivo-black@5.3.0` | The Archivo Black Project Authors |
| Bricolage Grotesque | `@fontsource-variable/bricolage-grotesque@5.3.0` | The Bricolage Grotesque Project Authors |
| Inter | `@fontsource-variable/inter@5.3.0` | The Inter Project Authors |
| Instrument Serif | `@fontsource/instrument-serif@5.3.0` | The Instrument Serif Project Authors |
| JetBrains Mono | `@fontsource-variable/jetbrains-mono@5.3.0` | The JetBrains Mono Project Authors |
| Space Grotesk | `@fontsource-variable/space-grotesk@5.3.0` | The Space Grotesk Project Authors |
| STIX Two Math | `@fontsource/stix-two-math@5.3.0` | The STIX Fonts Project Authors |
| STIX Two Text | `@fontsource-variable/stix-two-text@5.3.0` | The STIX Fonts Project Authors |
| Syne | `@fontsource-variable/syne@5.3.0` | The Syne Project Authors |
| Unbounded | `@fontsource-variable/unbounded@5.3.0` | The Unbounded Project Authors |

A compiled HyperFrames project carries copies of the font files it uses in
`fonts/`; keep the OFL notice with them when you redistribute a project.

## Other direct dependencies

At the time of the 0.2.0 release, HyperFrames declares Apache-2.0;
React, React DOM, Three.js, React Three Fiber, and the Anthropic SDK declare
MIT. Each installed package contains the authoritative licence information for
its version. Transitive dependencies may use additional licences.

This notice is informational and is not legal advice.
