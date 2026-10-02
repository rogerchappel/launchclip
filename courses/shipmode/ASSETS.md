# Material and licensing ledger

- `starter/index.html` and `finished/index.html`: original instructional copy,
  layout, CSS shapes, arrow characters, and timeline authored for this module.
  Covered by LaunchClip's root MIT license; preserve its notice when distributing.
- Fonts: Inter, embedded by the pinned HyperFrames compiler from its bundled
  fonts (SIL Open Font License). No font binary is committed in this lesson.
  Raw HTML outside HyperFrames can use a fallback; review compiled snapshots.
- Audio, stock images, footage, logos, likenesses, external course materials:
  none. The example does not reuse the older narrated demo or downloaded videos.
- `assets/gsap.min.js`: generated local copy from locked `gsap@3.14.2`, not
  committed or vendored as LaunchClip-owned code. GSAP remains governed by its
  Standard No Charge license, declared in `node_modules/gsap/package.json`:
  https://gsap.com/standard-license/. This is not MIT; the installed package
  does not contain a `LICENSE` file. Preserve the proprietary notices in the
  copied bundle. The license permits commercial use subject to its terms and
  restricts competing visual animation builders; review it before redistributing
  or repurposing the runtime. Reference verified 2026-10-02.
- Runtime: `hyperframes@0.7.58` declares Apache-2.0. Review installed dependency
  licenses and notices when distributing runtime packages; the lesson lockfile
  records transitive packages. Do not relicense third-party code under MIT.

See [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). The standalone lab
avoids the main package's direct Remotion dependencies; this does not change the
licensing obligations of users who install/use the full LaunchClip stack.
