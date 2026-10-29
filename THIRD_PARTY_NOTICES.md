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

## Person cut-out models (optional, subject stage)

`launchclip subject` cuts the presenter out of a recording with a person
segmentation model run through `onnxruntime-node` 1.27.0 (MIT, by Microsoft),
declared as an optional dependency. LaunchClip does not bundle any model: the
chosen one is downloaded on first use (or by `launchclip subject setup`) into
`$LAUNCHCLIP_HOME/models` (default `~/.launchclip/models`) and checked against
a pinned sha256. Every supported model is Apache-2.0:

| Model id | Model | Upstream | ONNX export downloaded |
|---|---|---|---|
| `modnet` | MODNet portrait matting (ZHKKKe) | <https://github.com/ZHKKKe/MODNet> | `Xenova/modnet` on Hugging Face |
| `mediapipe-selfie` | MediaPipe selfie segmentation (Google) | <https://github.com/google-ai-edge/mediapipe> | `onnx-community/mediapipe_selfie_segmentation` on Hugging Face |
| `u2net-human` | U²-Net human segmentation (Xuebin Qin et al.) | <https://github.com/xuebinqin/U-2-Net> | `u2net_human_seg.onnx` from the `danielgatis/rembg` releases (MIT) |

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
versions and loaded from `node_modules` (latin subset, upright faces only for
the families added for seeded styles, plus the unsubset STIX Two Math for
symbols). The files together stay under a 1.5 MB budget
(`test/fonts.test.js`); a project loads only the role defaults and the
families its brand names. The registry that names them is `kit/core/fonts.mjs`.
Every family is licensed under the SIL Open Font License, Version 1.1
(`OFL-1.1`); each package ships the licence text in its `LICENSE` file. The
font software is not relicensed under LaunchClip's MIT License, and the fonts
may not be sold on their own.

| Family | Package | Copyright holder (from the package LICENSE) |
|---|---|---|
| Anton | `@fontsource/anton@5.3.0` | The Anton Project Authors |
| Archivo Black | `@fontsource/archivo-black@5.3.0` | The Archivo Black Project Authors |
| Bebas Neue | `@fontsource/bebas-neue@5.3.0` | The Bebas Neue Project Authors |
| Big Shoulders Display | `@fontsource-variable/big-shoulders-display@5.3.0` | Google Inc. |
| Bricolage Grotesque | `@fontsource-variable/bricolage-grotesque@5.3.0` | The Bricolage Grotesque Project Authors |
| DM Sans | `@fontsource-variable/dm-sans@5.3.0` | The DM Sans Project Authors |
| DM Serif Display | `@fontsource/dm-serif-display@5.3.0` | Adobe Systems Incorporated (Reserved Font Name 'Source'); Google LLC |
| Fira Code | `@fontsource-variable/fira-code@5.3.0` | The Fira Code Project Authors |
| Fraunces | `@fontsource-variable/fraunces@5.3.0` | The Fraunces Project Authors |
| Instrument Serif | `@fontsource/instrument-serif@5.3.0` | The Instrument Serif Project Authors |
| Inter | `@fontsource-variable/inter@5.3.0` | The Inter Project Authors |
| JetBrains Mono | `@fontsource-variable/jetbrains-mono@5.3.0` | The JetBrains Mono Project Authors |
| Lexend | `@fontsource-variable/lexend@5.3.0` | The Lexend Project Authors |
| Manrope | `@fontsource-variable/manrope@5.3.0` | The Manrope Project Authors |
| Oswald | `@fontsource-variable/oswald@5.3.0` | The Oswald Project Authors |
| Outfit | `@fontsource-variable/outfit@5.3.0` | The Outfit Project Authors |
| Playfair Display | `@fontsource-variable/playfair-display@5.3.0` | The Playfair Display Project Authors (Reserved Font Name "Playfair Display") |
| Plus Jakarta Sans | `@fontsource-variable/plus-jakarta-sans@5.3.0` | The Plus Jakarta Sans Project Authors |
| Sora | `@fontsource-variable/sora@5.3.0` | The Sora Project Authors |
| Space Grotesk | `@fontsource-variable/space-grotesk@5.3.0` | The Space Grotesk Project Authors |
| STIX Two Math | `@fontsource/stix-two-math@5.3.0` | The STIX Fonts Project Authors |
| STIX Two Text | `@fontsource-variable/stix-two-text@5.3.0` | The STIX Fonts Project Authors |
| Syne | `@fontsource-variable/syne@5.3.0` | The Syne Project Authors |
| Unbounded | `@fontsource-variable/unbounded@5.3.0` | The Unbounded Project Authors |
| Young Serif | `@fontsource/young-serif@5.3.0` | The Young Serif Project Authors |

A compiled HyperFrames project carries copies of the font files it uses in
`fonts/`; keep the OFL notice with them when you redistribute a project.

## Lucide icons

`kit/core/icons-lucide.mjs` vendors the Lucide icon set (`lucide-static@1.61.0`,
<https://lucide.dev>) as path data, generated by `scripts/vendor-lucide.mjs`.
Lucide is licensed under the ISC License, Copyright (c) 2026 Lucide Icons and
Contributors. The icons Lucide derives from the Feather project (listed in
the licence) are also under the MIT License, Copyright (c) 2013-present Cole
Bemis. The full licence text is kept at the top of
`kit/core/icons-lucide.mjs`; keep it with any copy of that file. The icons are
not relicensed under LaunchClip's MIT License.

## World map data

`kit/core/world-110m.mjs` holds country shapes from Natural Earth 1:110m Admin 0
countries (public domain, <https://www.naturalearthdata.com>), taken from the
`world-atlas@2.0.2` package (ISC License, Copyright 2013-2019 Michael Bostock)
and projected by `scripts/vendor-world.mjs`. The world-atlas licence text is
kept at the top of that file. Natural Earth asks for no attribution; we credit
it anyway.

## MathJax

`src/math/mathjax-tex-svg.js` is MathJax 3.2.2 (<https://www.mathjax.org>),
its TeX input and SVG output bundled for Node by `scripts/vendor-mathjax.mjs`
to typeset the `equation` module. MathJax is Copyright (c) 2009-2022 The
MathJax Consortium and licensed under the Apache License, Version 2.0
(<http://www.apache.org/licenses/LICENSE-2.0>); the notice is kept at the top
of that file. Its glyph outlines are drawn from the MathJax TeX fonts and are
written into a typeset equation's `params.typeset`. MathJax is not relicensed
under LaunchClip's MIT License.

## AI model providers (optional, paid)

Planning, scripts, the headless critic and some assets can call OpenAI,
Anthropic or OpenRouter, only with the user's own `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`. LaunchClip ships no keys and no
model output. Each request, and what the user does with its output, is
governed by that provider's terms and usage policies for the account that
made it, not by LaunchClip's licence:

- <https://openai.com/policies>
- <https://www.anthropic.com/legal>
- <https://openrouter.ai/terms>

Kokoro and the person cut-out models are downloaded from Hugging Face on first
use; their licences are listed above.

## Copyleft licences among transitive dependencies

Two packages that other dependencies install use file-level or library
copyleft licences. LaunchClip does not modify or bundle either:

- `mediabunny` and its `@mediabunny/*` encoders (MPL-2.0), installed by
  Remotion's media packages. Source: <https://github.com/Vanilagy/mediabunny>.
- libvips (LGPL-3.0-or-later), the image library inside `sharp`'s prebuilt
  `@img/sharp-libvips-*` binaries, which `@huggingface/transformers` installs
  for the optional Kokoro voice. `sharp` itself is Apache-2.0. Source:
  <https://github.com/libvips/libvips>.

## Other direct dependencies

At the time of the 0.2.0 release, HyperFrames declares Apache-2.0;
React, React DOM, Three.js, React Three Fiber, and the Anthropic SDK declare
MIT. Each installed package contains the authoritative licence information for
its version. Transitive dependencies may use additional licences.

This notice is informational and is not legal advice.
