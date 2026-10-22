# Third-Party Notices

LaunchClip's own source code is licensed under the MIT License. Dependencies
installed with LaunchClip remain governed by their respective licences and are
not relicensed under LaunchClip's MIT License.

## Remotion

LaunchClip 0.1.1 depends on Remotion 4.0.489 packages for Remotion-based video
rendering, including `remotion`, `@remotion/cli`,
`@remotion/google-fonts`, `@remotion/motion-blur`, `@remotion/three`, and
`@remotion/transitions`.

Remotion 4.0.489 uses the Remotion License. Its installed licence text states
that individuals, non-profit organisations, organisations evaluating Remotion,
and for-profit organisations with up to three employees are eligible for the
free licence; other for-profit organisations require a company licence. The
published metadata for `@remotion/transitions` 4.0.489 declares that package
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

## ElevenLabs voice (optional, opt-in)

The ElevenLabs provider calls the ElevenLabs API only when
`ELEVENLABS_API_KEY` is set. Use of that service and of its output is
governed by the ElevenLabs terms of service.

## Other direct dependencies

At the time of the 0.1.1 release candidate, HyperFrames declares Apache-2.0;
React, React DOM, Three.js, React Three Fiber, and the Anthropic SDK declare
MIT. Each installed package contains the authoritative licence information for
its version. Transitive dependencies may use additional licences.

This notice is informational and is not legal advice.
