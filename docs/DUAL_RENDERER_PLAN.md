# Plan: HyperFrames and Remotion as parallel renderers

Status: draft
Date: 2026-10-22
Builds on: [STORYBOARD_ENGINE_RFC.md](STORYBOARD_ENGINE_RFC.md)

## Decision

LaunchClip keeps **two first-class render paths** in this repo:

- **HyperFrames**, which already works well;
- **Remotion**, built alongside it to the same quality bar.

Both are driven by the same storyboard (`story.json`), the same module specs,
the same audio, captions and evidence tooling, and the same gates. The creative
prompt is shared. Only the runtime contract and the render adapter differ.

The goal is output from the two renderers that is close to identical, then
improving both together. Clutchcut is **out of scope** for now. The Remotion
path is written in clutchcut's idiom (Remotion 4.0.536, React 19.3, TSX,
frame-pure components, no WebGL in portable modules), so moving it across later
is mostly a copy.

This plan replaces RFC §6's "pick one renderer" trial with "keep both, prove
parity". The RFC's other sections (lanes, `story.json`, module rules, tiers,
eval, voice) stand unchanged.

## Current state

| Area | HyperFrames | Remotion |
|---|---|---|
| Skill lane (`launchclip-create-video`) | Full: concept tournament, authoring, `cinematic-check` | None |
| Editorial modules (14 kinds) | `editorial-ui-modules.mjs` emits HTML, CSS and GSAP | None |
| Captions | `word-captions.mjs` GSAP runtime | Per-word captions in `motion-engine/` |
| Layout check | `hyperframes check --strict` (DOM) | None |
| Stills for evidence | `hyperframes snapshot` | None (`remotion still` available) |
| Existing compositions | Generated `index.html` | `remotion/` (social, premium), `motion-engine/` (`MotionGolden`) |
| Version | hyperframes 0.7.58 | remotion 4.0.489 (bump to 4.0.536) |

Already independent of the renderer: the motion and audio gates (they analyse
the MP4), the critic and candidate receipts, the recorded-video base edit and
readiness gate, `synth-audio-kit`, `build-mix`, `master-loudness`, `captions.json`
chunking, `NARRATION.json`, `BEATS.json` and the Shorts delivery profile.

## Architecture

```
            brief / inputs
                  │  (shared skill prompt, lane routing)
                  ▼
             story.json  ──────────────► audio: build-mix, master
                  │                      captions.json
                  │                      evidence schedule
      ┌───────────┴───────────┐
      ▼                       ▼
 HyperFrames compiler     Remotion compiler
 index.html + GSAP        StoryComposition (TSX)
      │                       │
      ▼                       ▼
 renderer adapter: render · still · check · preview
                  │
                  ▼
   draft.mp4 → shared gates → cinematic-check
```

Each module has one spec and two emitters:

```
module spec (JSON) ─► core: validate · layout rect · motion windows · events · theme
                          ├─► emitHyperFrames → {html, css, motion, events, layout}
                          └─► <Module/> React  → frame-pure, same events and layout
```

The core stays plain JS with no renderer imports, because it is the part both
emitters and the gates share.

## Phases

### Phase 0: Foundation

- Bump all `remotion` / `@remotion/*` packages to 4.0.536 and React to 19.3.
  Run the existing Remotion tests (`test/pipeline.test.js`, `test/motion.test.js`).
- New Remotion code is TSX under `remotion/story/`. The Remotion bundler
  compiles it, so no separate `tsc` step is needed for rendering.
  `npm run typecheck` (tsconfig.json: strict, noEmit) checks kit/remotion and the test entries in CI.
- Keep `@remotion/three` confined to the legacy `premium` composition. Portable
  modules use only DOM, SVG and CSS.

### Phase 1: Shared contract (RFC phase 1)

- `story.json` v1 schema and validator (`src/story/schema.js`), plus anchor
  resolution (`word:<text>[#n]`, `beat:<n>`, seconds) against `NARRATION.json`
  and `BEATS.json`.
- A renderer adapter interface in `src/toolchain.js`, with `hyperframes` and
  `remotion` implementations:
  `render(project, out, opts)`, `still(project, t, out)`, `check(project)`,
  `preview(project)`.
- Make the gates independent of the renderer:
  - Read boundaries and format from `story.json`, falling back to the existing
    `index.html` parsing.
  - Rename the temporal-evidence source to `browser-still`, still accepting
    `hyperframes` from existing receipts.
  - `build-evidence.mjs` takes stills through the adapter.
  - `cinematic-check` accepts `--renderer hyperframes|remotion` and calls the
    matching adapter for `verifyProject`.

### Phase 2: Motion primitives

A small library in `src/motion/` of frame-pure functions that the Remotion
modules use, and that the tests use to check HyperFrames parity:

- easing curves named and shaped like GSAP's (`power1-4`, `expo`, `back`,
  `circ`, `sine`, `steps`), so a GSAP `ease: "power3.out"` maps one-to-one;
- keyframe tracks (`track([[t, v, ease], …])(t)`), stagger, split text, count-up
  (matching the 19-frame `textFrames` behaviour), springs with fixed presets;
- velocity-shaped motion blur that resolves to zero at settle (RFC §5).

Every function takes absolute time and returns a value, so nothing goes stale
when the renderer seeks backwards.

### Phase 3: Module parity

1. Split `editorial-ui-modules.mjs` into a core (validation, geometry, timing,
   events, theme) and a HyperFrames emitter. Existing output must not change;
   the current 30 tests prove it.
2. Add React emitters for the same kinds, in this order:
   - **First slice:** `metric`, `growth-chart`, `callout`, plus captions from
     `captions.json`
   - then `checklist`, `step-rail`, `progress`, `code-snippet` (with typing),
     `excerpt-window` (with sweep), `focus-flow`, `media-window`, `date-card`,
     `status-rack`, `audience-grid`, `trend-chart`
3. Add the RFC §5 catalogue modules that don't exist yet, in both renderers at
   once: `hook-title`, `kinetic-words`, `equation-lockup`, `gauge-compare`,
   `flow-compare`, `count-up`, `process-steps`, `archive-card`, `logo-row`,
   `cta`.
4. **Parity test** per module: render the same spec in both renderers at the
   sampled times (enter, mid, settle, exit, each event), diff the frames, and
   fail above a per-module threshold. Golden stills live in the repo.

### Phase 4: Story compilers

- `story.json` → HyperFrames project: adapt `hyperframes_assembler.js` to place
  module emitters, typed transitions, the root `<audio>` and captions.
- `story.json` → Remotion: `StoryComposition`, with one `<Sequence>` per scene,
  typed boundaries through `@remotion/transitions` (`cut`, `push`, `whip`,
  `zoom`, `iris`, plus `morph` handled by the modules), one `<Audio>` for the
  mix, captions, a loop ending, and `calculateMetadata` from `format`.
- Golden: freeze the Newton's law of cooling Short as `story.json` and render it
  through both paths. Compare render time, gates and frame diffs.

### Phase 5: Layout check for both renderers

There is no Remotion equivalent of `hyperframes check`. Build one from data,
which also strengthens the HyperFrames path:

- Every module declares its rect and motion windows (already true for the
  editorial modules). Sweep the timeline and check safe-zone bounds, collisions
  between same-time elements, caption-band clashes, and minimum text size.
- Confirm on stills: brand-role contrast at least 3:1, text not clipped, lower
  third not empty in Shorts.
- HyperFrames keeps `hyperframes check` as an extra layer.

### Phase 6: Skills

- Two entry skills: `launchclip-create-video` (HyperFrames; its name stays so
  existing users aren't broken) and `launchclip-create-video-remotion`.
- The creative funnel, intake, music, evidence, review and delivery text is
  shared. Each skill must ship self-contained, so keep shared sources in one
  place and generate both `SKILL.md` files and their shared references with a
  script. A test fails when the generated files drift from the sources.
- Each skill gets its own runtime contract: the existing
  `standalone-hyperframes.md` and a new `standalone-remotion.md`.
- Custom modules (bespoke tier only) follow the same rule in both renderers:
  output is a function of time only, with no `Math.random` or `Date.now`. On
  Remotion that also means no animation state in `useState`/`useEffect`. A lint
  enforces it.

### Phase 7: Parity and quality eval

- Extend `eval:production` with a renderer dimension: each fixed brief runs on
  both paths, recording gate pass rate, critic score, render time and frame
  diff against the other renderer.
- The cross-model tiers from RFC §8 follow on top of this.

## First slice (one PR)

1. Phase 0 version bump, with the existing tests green.
2. `story.json` schema, validator and anchor resolution.
3. Renderer adapter skeleton, with `still` and `render` for both renderers.
4. Motion primitives: easing, tracks, count-up.
5. The `metric` module split into core plus two emitters, and a frame-diff
   parity test.

This proves the parity method end to end before the rest of the modules are
ported.

## Open questions

- **Skill packaging:** two generated skills (proposed), or one skill that asks
  which renderer to use at intake.
- **Parity thresholds:** font anti-aliasing and blur differ between Chrome
  paths, so the thresholds need tuning per module.
- **Licences:** confirm Remotion company licence terms and the HyperFrames
  licence before any commercial use (RFC §11).
- **`motion-engine/`:** fold its footage-led event timeline into `story.json`'s
  `footage-led` lane later, or keep it as a separate legacy path.
