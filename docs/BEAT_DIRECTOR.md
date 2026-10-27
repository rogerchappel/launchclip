# The beat director

Long-form explainers (10–20 minutes daily, up to 60) need many visual events but few cuts. The benchmark is a 16-minute faceless explainer: 170 visual events in 975 s (median 5.2 s apart, p10 2.5 s, p90 9.8 s) but only 50 hard cuts. Most new visuals are builds inside a shot, over a backdrop that holds for the chapter.

The beat director plans that density deterministically, before any model or render is involved. It gives every 3–10 s clause of the narration a visual decision and checks the whole plan against a cadence target.

```text
SCRIPT / NARRATION.json words + chapters
research/evidence.json (launchclip.evidence.v1) + research/captures/*.json (launchclip.capture.v1)
        │
        ▼  longFormChunks: per chapter, ≤ 180 s each, keyed for resume
clauseBeats ─ extractFacts ─ matchEvidence ─ visualKind
        │
        ▼  capability table (kit/core/visual-capabilities.mjs) + visual history
states (module, params, change) → shots of 2–4 states → chapters on a plate
        │
        ├─ BEATMAP.json (launchclip.beat-map.v1) + beatMapReport (the cadence gate)
        ├─ beatMapToDirection → DIRECTION.json (launchclip.direction-map.v1)
        ├─ beatMapToStory     → storyboard.json for any window
        └─ cutShorts          → 3–5 Shorts (9:16) at the short-form cadence
```

## Files

| File | What it owns |
|---|---|
| `kit/core/beat-director.mjs` | Clauses, facts, evidence matching, directing a chunk, the whole transcript, the report, conversions, dry runs |
| `kit/core/visual-capabilities.mjs` | What each module can show, which captures it renders, its fallbacks, and params from a clause's facts |
| `kit/core/cadence.mjs` | `CADENCE_BENCHMARK`, `CADENCE_TARGETS` per format, `cadenceTarget(format, style)`, `eventStats`, `cadenceGate`, `cadenceReport` |
| `kit/core/long-form.mjs` | `longFormChunks`: the resumable planning chunks |
| `kit/core/cutdown.mjs` | `chooseShortWindows`, `shortFromBeatMap`, `cutShorts` |
| `eval/beat-map-dry-run.mjs` | The dry run: `SCRIPT.md` → `NARRATION.json`, `BEATMAP.json`, `DIRECTION.json`, `SHORTS.json`, `CADENCE.md` |
| `eval/formats.mjs`, `eval/scorecard.mjs`, `eval/formats.json` | The six-format quality harness (`npm run eval:formats`) |

## Cadence targets

`CADENCE_TARGETS` holds one band per format: `long-form`, `short-form`, `talking-head`, `art-direction`, `motion-graphics` and `animated`. Each band sets:

- events per minute (min, target, max);
- the seconds between events: a p50 band, a p10 floor and a p90 ceiling;
- the longest static run;
- the seconds between hard cuts;
- the number of states per shot.

Each band also sets **words per event**: spoken words per visual event. Long form is 10–20; the reference is ~15, at 2,547 words in 975 s, about one event per clause. Unlike seconds, this target holds whatever the voice's pace. `eventStats(…, {words})` measures it, and the gate checks it when the word count is known.

`cadenceTarget(format, style)` scales the seconds for a style: `calm` ×1.3, `default` ×1, `energetic` ×0.8. Rates scale the other way. The long-form band contains the benchmark: a p50 of 4–6.5 s, a p90 under 10.5 s, a longest static run under 14 s and cuts 15–25 s apart.

`cadenceGate(eventStats(events, {duration, cuts}), target)` checks:

- `per_min`
- `gap_p50`
- `gap_p10`
- `gap_p90`
- `longest_static`
- `cut_gap_p50`

`cadenceReport` prints a line per check. The planner reads events from the plan: every state start is an event, and every shot start is a cut. The scorecard reads the same measures from rendered frames.

## The beat map (`launchclip.beat-map.v1`)

```text
{schema, title, format: {width, height}, cadence: {format, style}, duration,
 chapters: [{id, title, start, end, plate: {kind, params: {tint}}, background,
   shots: [{id, start, end,
     states: [{id, words: [a, b], start, end, text, intent, kind,
               capability, module, fallback?, change: enter|build|swap,
               params, evidence?: {claim, status, kind, score, source, quote?, capture?}, why}]}]}],
 chunks: [{id, chapter, words, start, end, key, shots: [ids], history}],
 report: {cadence: {…eventStats, gate}, shots, variety, evidence, fallbacks, chunks}}
```

- **Clauses.** `clauseBeats` splits the narration at the best break near the target length, scoring:
  - sentence ends 3;
  - commas and dashes 2;
  - pauses of 0.3 s or more 1.5;
  - a following conjunction 1;
  - a following preposition or relative word 0.8.

  It never crosses a chunk, and a tail shorter than the minimum joins the clause before it. For long form, the target is 4.4 s and clauses run 3–10 s. For other formats, the lengths scale with the format's band.
- **Facts.** `extractFacts` finds numbers (value, unit, currency, scaled value, and the words after the number as its label), years and month-days, a list ("A, B and C"), a quote, two sides ("A versus B"), places, an @handle and an equation. A number inside a name ("Halcyon 2", "version 1.5") is not a figure.
- **Kinds.** `visualKind` picks one of `VISUAL_KINDS`, in this order:
  1. the evidence capture's kind;
  2. a post, quote or equation;
  3. wording cues (commit, PR, diff, terminal, code, tokens);
  4. the numbers (a percentage → `share`, three or more → `series`, two → `compare`, money, compute, one → `stat`);
  5. dates, places and sides;
  6. structure cues (lineage, family, chain, documents, ranking);
  7. a list or process;
  8. otherwise `concept`.

  A chapter's first clause is a `title`.
- **Evidence first.** `matchEvidence` finds the ledger claim that shares at least two content words, or a number, with the clause. Contradicted claims never match. The match picks the claim's best supporting source (primary first, then by confidence). It finds the claim's capture by `capture.claim`, `capture.claims[]` or a matching source URL. A capture plays again only after 24 states; until then the claim keeps its source line. A capture moves the modules that render that capture kind to the front (post → `social-post`, PR → `repo-pr-card`, page → `media-window` playing `assets/evidence/<id>.mp4`).
- **Modules.** Candidates come from `capabilitiesFor(kind, {evidence, wide})`, so portrait canvases drop wide-only modules. Each candidate is scored by:
  - its order in the table;
  - a penalty for modules in the last eight states;
  - a penalty that grows with how often the module has been used;
  - a penalty from recent videos (`options.avoid`, as returned by `historyAvoid()` in `src/visual_history.js`);
  - a penalty for repeating the module before it;
  - a bonus for rendering the clause's capture;
  - a bonus for a planned module that is now registered.

  The best candidate whose params resolve wins (`resolveModule` on the map's canvas). A planned module that is not registered walks its fallback chain.
- **Builds.** When the next clause is in the same family (numbers, time, evidence, ideas), the module on screen can take it. `capabilityAdditions` appends the clause's own entries: a bar, a step, an icon, a row. The result is a `build` state, at most two in a row. Any other state is a `swap`, a new card over the same plate. The first state of a shot is an `enter`.
- **Shots.** States group into shots. A shot closes at four states, past 25 s, or once it has held 15 s and 2 states and the next clause is either a topic shift (a sentence end into another family) or past the 20 s midpoint.
- **Plates.** Each chapter gets a backdrop plate in `kit/core/plates.mjs` terms (`hex-shell`, `silk`, `strands`, `bokeh`, each with a tint). The same plate is never used for two chapters in a row, nor reused among the last three. Each plate also names a `story.background` kind to use until plates are registered.
- **Never invented.** Number modules get params only from the clause's own numbers. A clause with no number never gets a stat card with a placeholder figure.

## Structure

- **Mid-roll calls to action.** `directLongForm(…, {ctas})` takes seconds, or `{at, action, detail, handle}`. The clause under each time becomes a `cta` state, drawn by the `cta` module.
- **Logo stings.** `stings: true` makes the first and last clause a `sting`: `logo-sting` when it is registered, else `brand-lockup` when `stingBrand {mark, wordmark}` is given, else the video's title.
- **The fixture's structure.** The dry run uses the reference's structure: calls at 3:30, 9:40 and 15:00, with stings at both ends.
- **Story arcs.** The reference tells three stories in one video, each a claim → evidence → audit → verdict arc (about 8.5, 4.5 and 3 min). Planning with arc roles is a follow-up. For now, chapters carry the stories.

**Checked on a real transcript.** The planner was run locally on the reference's own Whisper word timings and its chapter times. The transcript is someone else's script, so it is not committed. The result:

| Measure | Planner | Reference |
|---|---|---|
| Visual events | 173 | 170 |
| States (one at 0 s, then one per event) | 174 | — |
| Median gap | 5.4 s | 5.2 s |
| p90 gap | 7.7 s | 9.8 s |
| Hard cuts | 51 | 50 |
| Words per event | 15.1 | ~15 |

## Scale and resume

`longFormChunks(chapters, words, {chunkSeconds: 180})` cuts each chapter at a sentence end into chunks of at most three minutes. A chunk's key hashes:

- its words and their times;
- its chapter;
- the settings (cadence, style, canvas, registered modules, ledger and captures);
- the visual history it starts from.

`directLongForm(input, {previous})` reuses every chunk whose key matches. After an edit, every chunk up to the first change is reused, and every chunk from there on is replanned (its history changed). The history carries across the whole video: recent modules, module counts, plates and capture plays. So an hour-long video doesn't fall back on one motif. In tests, a 60-minute run of 48 chapters is planned in under a second.

## Shorts from the long form

`cutShorts(map, words, {count: 3–5})`:

1. **Windows.** It scores windows of whole clauses (20–50 s, ending on a sentence) that open on a hook-able clause: a hook intent, a number, a quote or evidence. A window scores higher for evidence and numbers.
2. **Re-direction.** It re-directs each window with `directChunk` at the short-form cadence on 1080×1920, carrying the long form's evidence over.
3. **The opening.** It swaps a title-card opener for an image (the short-video rule in `kit/core/skeleton-library.mjs`).
4. **The skeleton.** It attaches a library skeleton when one fits (`chooseSkeleton`).
5. **The story.** It writes a looping storyboard with word captions.

Each chapter offers its best window that passes the short-form gate. The output is one Short per chapter, never overlapping.

## The modules other sessions are adding

The capability table lists them as `planned`: `social-post`, `social-stack`, `social-wall`, `repo-pr-card`, `commit-card`, `diff-view`, `evidence-chain`, `date-pinned-timeline`, `terminal-session`, `dot-field`, `particle-text`, `tokenizer`, `glass-bars-3d`, `coin-stack`, `rack-shelf`, `paper-stack`, `planet-family`, `small-multiples`, `date-carousel`, `month-grid`, `lineage-graph`, `equation` and `title-decompose`.

- **Not registered yet.** `resolveCapability` walks to the closest module the kit has (for example `glass-bars-3d` → `bar-chart`). The report lists every fallback used.
- **Once registered.** The director picks the module itself.
- **Params.** Until the module has a params builder in `visual-capabilities.mjs`, it gets a neutral bag: `{title, text, values?, evidence?}`. If the bag doesn't resolve, the director falls back.

This means the merge order doesn't matter. Adding the module's builder is a one-line follow-up when it merges.

## The dry run and the gate

`node eval/beat-map-dry-run.mjs [folder] [--wpm 155] [--style default] [--fresh]` turns `SCRIPT.md` (with `# Title` and `## Chapter` headings) into steady-pace dry-run timings and plans the map. It writes the files listed in the table above. It exits non-zero and prints the failing checks when the plan misses the cadence gate.

The fixture `eval/fixtures/long-form-16min` is an original script about a fictional lab's model launch, with a ledger of 25 claims and six captures:

- 16.3 minutes, 12 chapters, 48 shots, 158 states;
- 157 events: 9.65 per minute, gaps p10 3.9 / p50 5.8 / p90 8.9 s;
- 47 cuts, 20.6 s apart at the median;
- 23 modules, 24 builds;
- 65% of claims on a sourced visual;
- four Shorts, each passing the short-form gate.

## The scorecard (`npm run eval:formats`)

`eval/formats.json` holds a golden brief per format. Each brief has a short sample: an example project, a minute of the beat-map fixture, or a Short cut from it. The runner stages, validates, layout-checks, compiles and renders each sample (`--renderer hyperframes|remotion`, `--quality draft`), then measures the video:

- **Cadence.** Every frame's ffmpeg scene score is read in one pass. Events are frames over 0.04, 0.08 or 0.15, merged when closer than 1.5 s (or the format's p10 floor). The gate reads 0.08 on every frame, as on the reference, so the numbers compare with the benchmark. Cuts come from 0.15.
- **Soft events.** The same thresholds on frames 0.25 s apart, as a diagnostic that can warn but not fail. A fade or a build on a quiet frame spreads its change over many frames and never reaches the reference's thresholds at full frame rate.
- **Motion on hold.** `freezedetect` (noise 0.002, 1 s minimum) gives the share of the runtime that keeps moving.
- **Evidence coverage.** The beat map's claims (or the storyboard's number and quote scenes) shown with a source.
- **Module variety.** Distinct modules over scenes, plus the top module's share.
- **Layout and legibility.** `checkLayoutProject` errors and warnings.
- **Caption hygiene.** Captions on where the format needs them, a peak of at most 4.2 words per second over 2 s, and clean word timings.
- **A/V sync.** The share of planned scene starts that land on a change within 250 ms, the median offset, and the audio stream's length against the video's. A change is a local peak in the per-frame scene score, measured against the video's own noise rather than a fixed threshold.

Each check passes, warns (within 15% of the line) or fails. The brief's score is the share of points. `--no-render` scores the plan alone. `--reuse` keeps a render whose storyboard hasn't changed. The command writes `qa/format-eval/report.{json,md}` and a contact sheet per format.

## Not yet

- **Builds re-enter.** A `build` state renders as a new scene with a fade, so the whole card animates in again. Mapping `change: build` onto in-shot state changes is a follow-up for after the shot-states work lands.
- **Dry-run timing.** Dry-run timings are steady-pace estimates. A real voice (`NARRATION.json` from TTS or a transcript) replaces them, and the plan is redone chunk by chunk.
- **Rules, not a model.** The director is rule-based. A model pass that rewrites `headline` and `params` per state on top of the map is the natural next step; the gate and the scorecard already measure the result.
