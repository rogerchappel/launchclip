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

At the time of the 0.1.1 release candidate, HyperFrames declares Apache-2.0;
React, React DOM, Three.js, React Three Fiber, and the Anthropic SDK declare
MIT. Each installed package contains the authoritative licence information for
its version. Transitive dependencies may use additional licences.

This notice is informational and is not legal advice.
