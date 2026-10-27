## Author and repair

For recorded-video editorial work, follow `references/recorded-video.md`
instead of this cinematic sequence. For cinematic creation, follow the
scaffold, `storyboard.json` contract, frame-pure rule, and commands in the bundled
reference. Work in this order:

1. Verify Node.js, FFmpeg, and the pinned Remotion toolchain
   (`remotion@4.0.536`, `@remotion/cli@4.0.536`, React 19.3).
2. Probe, trim, transcribe, and temporally inspect supplied media locally.
3. Scaffold a project from this skill's `assets/remotion-kit` without
   installing any skill pack.
4. Copy or link only approved assets into the project's `assets/` directory
   using stable local paths.
5. Pick the skeleton and write `ANGLE.json`, then run the five-concept
   tournament across the angles with fresh-context selection.
6. Write and independently edit the canonical retention story.
7. Produce or prepare narration, measure the real take, then freeze the
   storyboard, design system, music/edit grid, and quality targets. For a
   synthesised voice, write the script into `audio.narration`
   (`{text, provider?, voice?, speed?}`; defaults Kokoro, `af_heart`, speed
   1.2) before any scenes, run `launchclip voice <project>` to synthesise it
   (cached) and print its real duration and per-sentence timing, adjust the
   text or `speed` until it fits, then size `format.duration` and the scenes
   to that take and anchor scene starts and hits to words (`word:<text>`).
   `finish` reuses the measured take. See "Narration" in the runtime
   reference.
8. Write `storyboard.json` from the frozen storyboard. Its typed `in` transitions
   are the declared phase-2 boundaries that `cinematic-check` reads. Render two
   independent opening candidates and two candidates for one representative
   unproven transition grammar. Compare their real pixels and motion at
   delivery size, choose deterministically, and preserve the candidate receipt
   and artifacts before full authoring.
9. Author every scene from the selected treatment and frozen artifacts:
   catalogue modules and `params` first, and bespoke TSX modules under
   `remotion/modules/` only for the flagship tier.
10. Run `launchclip story validate` early and after every edit.
11. Run `launchclip layout-check`, then render stills at the dense-hook times
    and on both sides of every boundary. Sample shared-world moves at
    departure, early acceleration, peak speed, late deceleration, and settle
    rather than checking only their endpoints.
12. Inspect every generated still and overview image, not only the command exit
    code.
13. Review the opening, every transition boundary, every major type state, and
    the final frame at delivery scale. Step adjacent frames in Studio when a
    still suggests clipping, popping, or a discontinuity.
14. Render a local draft, build the hashed temporal-evidence manifest with
    `--renderer remotion`, require the fresh-context critic to cite reviewed
    evidence IDs, and run `launchclip cinematic-check --renderer remotion`.
15. Repair the smallest responsible scene, module parameter, mix, or plan, then
    rerun the failed gate. For a second-pass scene fix, look first with
    `launchclip finish <project> --preview-scene <id>`, then run
    `launchclip finish <project> --scene <id>`: it re-renders only that scene's
    segments, re-runs master, evidence and gates, and writes a before/after
    still to inspect. Stop after three bounded passes and report
    `needs-repair` instead of weakening the contract.

Do not weaken checks, mark accidental overlaps as intentional, or use draft
rendering to conceal a composition defect. Keep all motion a pure function of
the current frame: no animation state in `useState` or `useEffect`, no
`Math.random()` or `Date.now()`, and no CSS transitions or keyframe animations.
