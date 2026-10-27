## Author and repair

For recorded-video editorial work, follow `references/recorded-video.md`
instead of this cinematic sequence. For cinematic creation, follow the
scaffold, composition contract, and commands in the bundled
reference. Work in this order:

1. Verify Node.js, FFmpeg, and HyperFrames availability.
2. Probe, trim, transcribe, and temporally inspect supplied media locally.
3. Scaffold a blank project without installing any skill pack.
4. Copy or link only approved assets into the project using stable local paths.
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
8. Put `data-launchclip-cinematic-contract="phase-2"` on the composition root.
   Render two independent opening candidates and two candidates for one
   representative unproven transition grammar. Compare their real pixels and
   motion at delivery size, choose deterministically, and preserve the
   candidate receipt and artifacts before full authoring.
9. Author the composition and a motion sidecar from the selected treatment and
   frozen artifacts.
10. Run static lint early.
11. Run strict browser checks with transition and dense-hook snapshots. Sample
   shared-world moves at departure, early acceleration, peak speed, late
   deceleration, and settle rather than checking only their endpoints.
12. Inspect every generated overview image, not only the command exit code.
13. Review the opening, every transition boundary, every major type state, and
    the final frame at delivery scale. Scrub adjacent frames when a snapshot
    suggests clipping, popping, or a discontinuity.
14. Render a local draft, build the hashed temporal-evidence manifest, require
    the fresh-context critic to cite reviewed evidence IDs, and run
    `launchclip cinematic-check`.
15. Repair the smallest responsible sequence, mix, or plan, then rerun the
    failed gate. In a storyboard project, run second-pass scene fixes with
    `launchclip finish <project> --scene <id>`: it re-runs master, evidence
    and gates and writes a before/after still to inspect (HyperFrames
    re-renders the whole video; partial rendering is Remotion-only). Stop
    after three bounded passes and report `needs-repair` instead of weakening
    the contract.

Do not weaken checks, mark accidental overlaps as intentional, or use draft
rendering to conceal a composition defect. Keep all motion deterministic and
seek-safe.
