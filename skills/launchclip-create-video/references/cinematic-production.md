# Cinematic Subscription Production Contract

Use this contract to create a premium one-shot video with the active subscription
agent. Keep every creative model judgment in the current agent session or a
fresh subscription subagent. Use LaunchClip only for the local
`cinematic-check`; never invoke its metered production stages.

## Contents

- [Freeze the evidence](#freeze-the-evidence)
- [Run the concept tournament](#run-the-concept-tournament)
- [Write and edit the retention story](#write-and-edit-the-retention-story)
- [Time the real narration before the edit](#time-the-real-narration-before-the-edit)
- [Plan continuous visual sequences](#plan-continuous-visual-sequences)
- [Render critical candidates](#render-critical-candidates)
- [Direct sound and music](#direct-sound-and-music)
- [Render, judge, and gate the draft](#render-judge-and-gate-the-draft)
- [Repair without lowering the floor](#repair-without-lowering-the-floor)

## Freeze the evidence

Create `BRIEF.md`, `EVIDENCE.md`, and `SOURCE.md` before ideation. Separate
claim-eligible facts from reference-only creative guidance. Record source IDs,
resource IDs, permissions, target audience, destination, CTA, aspect, duration,
language, and whether narration is supplied, generated with explicit approval,
or intentionally absent.

Inspect real source pixels and timing. Build an overview sheet, a dense first
four-second strip, and cut/motion-boundary views for source or reference video.
Do not let a reference support factual claims or become a shot-for-shot template.

## Run the concept tournament

Generate exactly five complete treatments before scripting. Make their hooks,
narrative engines, visual metaphors, spatial worlds, motion languages,
transition logics, and sound worlds materially different. Use at least three
different narrative engines and three different visual metaphors. Every concept
must contain a hook, proof, payoff, factual evidence links, and at least four
causal beats. Keep each spoken hook to 18 words or fewer.

Judge all five in a fresh context. Prefer a new subagent that sees only the
brief, evidence, source observations, and anonymous concepts. If subagents are
unavailable, run a separate judging pass without the proposal rationale or an
announced favorite. Score each criterion from 0–10:

| Criterion | Weight |
| --- | ---: |
| Scroll stop | 16 |
| Promise clarity | 11 |
| Audience fit | 10 |
| Causality | 10 |
| Grounded proof | 12 |
| Visual originality | 16 |
| Motion potential | 10 |
| Sound potential | 5 |
| Feasibility | 10 |

Subtract `0.8 × genericism`, `1.0 × slideshow risk`, and `1.5 × unsupported
clickbait`. Select the deterministic highest score; break ties by original
candidate order. Save the concepts, scores, penalties, required improvements,
and the winner in `CONCEPTS.json`. Do not choose by taste after scoring.

### `CONCEPTS.json` schema (`launchclip.concepts.v1`)

`cinematic-check` validates it. Missing required fields fail the `concepts`
gate; the rest are warnings in its report (`receipt_warnings`).

| field | required | notes |
| --- | --- | --- |
| `schema_version` | warn | `"launchclip.concepts.v1"` |
| `concepts` | yes | exactly 5 |
| `concepts[].id`, `title`, `logline`, `hook` | yes | non-empty strings; `hook` is the spoken hook, 18 words or fewer (warn) |
| `concepts[].scores` | yes | the nine criteria above, each 0–10 (missing criteria warn; a non-number fails) |
| `concepts[].penalties` | warn | `{genericism, slideshow_risk, unsupported_clickbait}` |
| `concepts[].total` | warn | weighted score minus penalties; a chosen concept that is not the highest total warns |
| `concepts[].chosen` | yes | exactly one `true` |
| `selected_id` | no | when present it must equal the chosen id |
| `judging`, `required_improvements`, `rationale` | warn | how the fresh-context judge saw the concepts, and its fixes for the winner |

```json
{
  "schema_version": "launchclip.concepts.v1",
  "judging": "fresh-context subagent; saw only the brief, EVIDENCE.md and anonymous concepts",
  "concepts": [
    {
      "id": "A",
      "title": "The stalled launch",
      "logline": "A release checklist where everything ships except the launch video, until one command unblocks it.",
      "hook": "Shipping is the easy part. The launch video is what stalls you.",
      "scores": { "scroll_stop": 7, "promise_clarity": 9, "audience_fit": 9, "causality": 9, "grounded_proof": 9, "visual_originality": 6, "motion_potential": 8, "sound_potential": 7, "feasibility": 8 },
      "penalties": { "genericism": 4, "slideshow_risk": 3, "unsupported_clickbait": 0 },
      "total": 72.8,
      "chosen": true
    }
  ],
  "selected_id": "A",
  "required_improvements": ["Keep proof to a few beats with continuous camera travel."],
  "rationale": "A covers the whole brief with built-in causality."
}
```

(The example shows one concept; a real receipt has all five, four with
`"chosen": false`.)

## Write and edit the retention story

Write the whole story from the selected concept before creating shots. Use the
roles `hook`, `promise`, `mechanism`, `proof`, `rehook`, `escalation`, `payoff`,
`closing_reframe`, and `cta_or_loop` as appropriate. Videos at least 20 seconds
need a rehook and escalation; videos at least 30 seconds need six or more real
narrative beats. Every beat must change the viewer's question or answer and
name a concrete visual noun.

Target 165–180 WPM for portrait short-form, 150–170 for landscape short-form,
and 145–165 for longer work. Put the promise by one second in portrait or two
seconds in landscape. Put grounded proof by three seconds in portrait, six in
landscape short-form, or eight in longer work. Preserve supplied narration
byte-for-byte and never add a CTA to speech the user already recorded.

Run a fresh-context retention edit and return the complete corrected story,
not comments alone. Require these minimum scores: hook 8, compression 7,
curiosity 8, clarity 8, proof 8, payoff 8, speakability 7, and visuality 8.
Keep revising until the returned story meets every floor and all factual claims
remain grounded. Save the canonical story, scores, findings, and concept link in
`STORY.json`; write the exact final spoken copy to `SCRIPT.md`.

### `STORY.json` schema (`launchclip.story-receipt.v1`)

`cinematic-check` validates it against `CONCEPTS.json` and the format
duration. Missing required fields fail the `story` gate; the rest warn.

| field | required | notes |
| --- | --- | --- |
| `schema_version` | warn | `"launchclip.story-receipt.v1"` |
| `concept_id` | yes | must be the chosen concept in `CONCEPTS.json` |
| `beats` | yes | in order; the first should be the `hook` (warn); 20 s and longer need a `rehook` and an `escalation`, 30 s and longer six or more beats (warn) |
| `beats[].role` | yes | `hook`, `promise`, `mechanism`, `proof`, `rehook`, `escalation`, `payoff`, `closing_reframe`, `cta_or_loop` (other values warn) |
| `beats[].spoken` | yes | the exact spoken line; `""` for a silent beat |
| `beats[].visual_noun` | warn | the concrete thing on screen |
| `narration.source` | yes | `synthesised` (`audio.narration` through `launchclip voice` / `finish`), `supplied` (the user's recording, kept byte-for-byte), `generated` (another approved voice), or `none` (intentionally unnarrated) |
| `narration.file`, `narration.script` | no | usually `NARRATION.json` and `SCRIPT.md` |
| `scores` | warn | the eight retention-edit scores; any below its floor warns |
| `editor`, `findings` | warn / no | who ran the fresh-context retention edit, and what it changed |

```json
{
  "schema_version": "launchclip.story-receipt.v1",
  "concept_id": "A",
  "editor": "fresh-context subagent retention edit",
  "beats": [
    { "role": "hook", "spoken": "Shipping is the easy part. The launch video is what stalls you.", "visual_noun": "release checklist with 'Launch video' stalled" },
    { "role": "promise", "spoken": "So describe the video, and get the video.", "visual_noun": "code panel typing launchclip finish" },
    { "role": "proof", "spoken": "Two renderers draw the same storyboard, matched on every sampled frame.", "visual_noun": "SSIM ≥ 0.97 count-up (the parity floor eval:renderers enforces)" },
    { "role": "rehook", "spoken": "So what can it draw?", "visual_noun": "kinetic question" },
    { "role": "escalation", "spoken": "Charts, counters, checklists, code.", "visual_noun": "module names" },
    { "role": "payoff", "spoken": "Brief, storyboard, finish, video.", "visual_noun": "four-node process diagram" },
    { "role": "cta_or_loop", "spoken": "Star it on GitHub.", "visual_noun": "CTA card with the repo handle" }
  ],
  "narration": { "source": "synthesised", "file": "NARRATION.json", "script": "SCRIPT.md" },
  "scores": { "hook": 8, "compression": 8, "curiosity": 8, "clarity": 9, "proof": 8, "payoff": 8, "speakability": 8, "visuality": 9 },
  "findings": ["Promise trimmed so the command lands by about 6 s."]
}
```

## Time the real narration before the edit

Prepare narration before final storyboard timing:

1. Use supplied speech, an explicitly approved voice provider, an approved
   local/system voice, or an intentionally unnarrated edit.
2. Probe the actual audio duration and derive word timings locally when speech
   exists.
3. Record word timing, pauses, beat boundaries, source, delivery direction, and
   measured duration in `NARRATION.json`.
4. Build the final edit grid and shot boundaries from that measured performance.

With the LaunchClip CLI and a synthesised voice, steps 2 and 3 are one
command: put the exact `SCRIPT.md` copy in `storyboard.json` as
`audio.narration.text` (scenes can still be empty), run
`launchclip voice <project>`, and read the duration, words per minute and
per-sentence timing it prints; it writes `NARRATION.json` and caches the take
for `finish`. Change `audio.narration.speed` (a generation parameter, not a
time-stretch) or the copy until the duration fits, then size the scenes.

Do not time-stretch a generated or supplied performance to rescue the plan.
Allow at most ±2% final conformance; otherwise adjust pauses, revise generated
copy, or replan the visuals. For an intentionally unnarrated piece, record an
explicit editorial beat grid instead of pretending timings were measured.

## Plan continuous visual sequences

Turn the story into a few 8–20 second evolving visual worlds, not one isolated
card per sentence. Author coherently within each sequence and parallelize only
between independent sequences. Freeze shared object identity, coordinate/depth
system, perspective, camera path, light direction, materials, type roles,
entry/exit geometry, velocity, blur envelope, and boundary handoff.

Give every beat a meaningful visible development: reveal, transformation,
comparison, traversal, focus shift, evidence state change, camera reframing, or
shared-object handoff. Keep text-only duration under 10%. Use at least five
visual registers for portrait short-form or four for landscape. Couple motion
blur to velocity and resolve it fully at every settle. Make SFX attach to
verified visible events, not arbitrary timestamps.

Write `STORYBOARD.md`, `DESIGN.md`, and `QUALITY.md` only after narration timing
is frozen. Include spoken anchor, viewer question, visual noun, internal motion,
transition geometry, SFX event, music state, safe areas, and entry/exit state for
every sequence.

## Render critical candidates

Before full authoring, render two independent local candidates for the opening
and two for one representative unproven high-risk boundary. Keep the selected
story, factual evidence, style system, sequence physics, and visible promise
fixed, but give each candidate a different first-principles composition and
camera solution. Candidate B must not repair, imitate, or average candidate A.

Compare actual pixels and motion at delivery size, not prose plans or source
code. Score scroll stop, promise/proof comprehension, mobile hierarchy,
art-direction specificity, depth/materiality, temporal development,
shared-object continuity, velocity/blur shape, crisp settle, and implementation
feasibility. Select deterministically by score and original candidate order.
Reject blank, invalid, generic, slideshow-like, unreadable, or discontinuous
candidates before comparison.

Preserve candidate snapshots or draft slices under
`qa/rendered-candidates/<candidate-id>/` and write
`qa/rendered-candidates.json` with candidate IDs, artifact paths, scores,
winner, preserve notes, and why every rejected candidate lost. Do not continue
when either required comparison has fewer than two admissible candidates.

Use `schema_version: "launchclip.subscription-rendered-candidates.v2"` and a
`comparisons` array containing at least one `kind: "opening"` comparison and
one `kind: "transition"` comparison. The transition comparison's `boundary_id`
must match a declared composition boundary. Every comparison must contain:

- a unique `id`, `judging_basis: "rendered-pixels-and-motion"`, ordered
  `candidate_order`, deterministic `selected_candidate_id`, and non-empty
  `selection_rationale`
- at least two candidates with unique `id` and `render_id`,
  `admissible: true`, and a non-empty rejection reason for every loser
- one encoded candidate clip or at least three lifecycle images per candidate;
  record every artifact as `{ "file": "project-relative/path", "sha256":
  "actual-file-hash" }`
- 0–10 candidate scores named `scroll_stop`,
  `promise_or_proof_clarity`, `mobile_hierarchy`,
  `art_direction_specificity`, `depth_materiality`, `temporal_development`,
  `continuity`, `velocity_blur_shape`, `crisp_settle`, and
  `implementation_feasibility`

Choose the highest mean score and break a tie by `candidate_order`.
`cinematic-check` recomputes that result, verifies the hashes and media
signatures, rejects duplicate render IDs or identical artifact sets, and
requires four admissible candidates across the opening and transition
comparisons. The receipt can audit separate renders, but it cannot prove
creative independence by itself; Candidate B must still be authored from the
frozen brief without Candidate A in context.

Render each isolated candidate with the same delivery geometry and sampling
times. The cheap path is `launchclip finish --candidate`: it renders a draft of
the candidate project with **no paid calls** (synth or no music, the cached
take of the narration or a free voice, else the offline test voice; no
evidence, no gates), copies the clip and its entry, peak and settle frames
(extracted by exact frame number) into
`<project>/qa/rendered-candidates/<candidate-id>/`, and adds the candidate,
with hashes and a render ID, to `<project>/qa/rendered-candidates.json`:

```bash
launchclip voice <project>        # once: cache the real take, so candidates share its timing
launchclip finish <candidate-a-project> --candidate open-a --into <project>
launchclip finish <candidate-b-project> --candidate open-b --into <project>
launchclip finish <candidate-c-project> --candidate trans-a --into <project> --boundary s3
launchclip finish <candidate-d-project> --candidate trans-b --into <project> --boundary s3
```

`--kind` defaults to opening, or transition with `--boundary`; `--at
0.4,1.2,2.6` picks the lifecycle times (default 15%, 50% and 90% of the
clip). Then judge the frames: fill each candidate's ten scores, set
`selected_candidate_id` (highest mean, ties by `candidate_order`),
`selection_rationale` and every loser's `rejection_reason`. A rerender keeps
the scores and refreshes the hashes.

To render a candidate by hand instead, preserve either the encoded candidate
clip or at least its entry, peak motion, and settled frames:

```bash
npx --yes hyperframes@0.7.58 snapshot <candidate-project> \
  --at <entry-seconds>,<peak-seconds>,<settle-seconds>
npx --yes hyperframes@0.7.58 render <candidate-project> \
  --quality draft --strict \
  --output <project>/qa/rendered-candidates/<candidate-id>/candidate.mp4
```

Use separate candidate project state or restore the frozen pre-candidate state
before authoring Candidate B. Do not let Candidate A's HTML, images, critic
notes, or validation errors enter Candidate B's context.

## Direct sound and music

Preserve narration as the primary information layer. If music is approved,
audition two supplied or approved candidates when available and select against
the story arc, speech masking, usable beats, and clean ending. Map cold open,
build, rehook lift, payoff, and resolve; do not use one unchanging volume bed.
Duck around dense speech and the final line.

Use a restrained semantic SFX vocabulary with variations and tails. Align cues
to actual rendered impacts, locks, reveals, or handoffs. Create
`AUDIO-MANIFEST.json` with absolute local paths using this shape:

```json
{
  "voiceover": { "path": "/absolute/project/assets/voice.wav" },
  "music": { "path": "/absolute/project/assets/music.wav" },
  "sfx_manifest": "/absolute/project/qa/sfx.json"
}
```

Use `null` for intentionally absent layers. Never include provider URLs or
secrets.

## Render, judge, and gate the draft

Complete static lint, strict browser checks, transition snapshots, dense hook
snapshots, and human visual inspection first. Then render a local draft before
opening Studio:

```bash
npx --yes hyperframes@0.7.58 render <project> \
  --quality draft --strict --output <project>/renders/draft.mp4
```

Ask a fresh-context critic to inspect the overview, delivery-resolution key
frames, dense opening strip, before/mid/after transition frames, typography
crops, and the actual draft when video inspection is available. Require it to
judge hook comprehension, causal clarity, proof, art direction, continuity,
motion physics/blur, transition meaning, timing, typography, source fidelity,
audio, payoff, and mobile readability. Give every reviewed frame or strip a
stable evidence ID and require each finding to cite those IDs. Save strict JSON
at `qa/critic.json`:

```json
{
  "verdict": "ship",
  "findings": [],
  "summary": "Fresh-context review of every required temporal artifact.",
  "evidence_ids_reviewed": [
    "hook-001-hyperframes",
    "hook-001-encoded-draft"
  ]
}
```

List every evidence ID in the temporal manifest under
`evidence_ids_reviewed`, including both sources for each scheduled sample. A
non-empty finding must also contain `evidence_ids` naming the exact artifacts
that support it. A clean `ship` verdict without complete evidence coverage
fails the phase-2 gate.

Use `verdict: "repair"` or `"replan"` for a failed review. Every finding must
contain a stable `id`, `severity: "blocking|major|minor"`, a concise `category`,
an actionable `message`, and a non-empty `evidence_ids` array. Add timing or
sequence identifiers when known; do not invent them when the evidence cannot
localize the defect.

Use `repair` or `replan` and actionable findings when it is not ready. Then run
the model-free local gate from a LaunchClip checkout or installed CLI:

```bash
launchclip cinematic-check <project> \
  --video renders/draft.mp4 \
  --critique qa/critic.json \
  --expect-audio \
  --audio-manifest AUDIO-MANIFEST.json
```

Omit the two audio flags only when audio is intentionally absent. The audio
gate estimates the voice-to-music margin from the music gain the mix used: it
reads `music.volume` from `AUDIO-MANIFEST.json` (which `launchclip finish`
writes), then the sound stage's bed volume in `finish.json`, so it agrees with
finish's own audio gate; `qa/cinematic/audio.json` records the value in
`mix_settings`. For a hand-built mix with neither, pass the gain you mixed the
music at with `--music-volume 0.32` (default 0.15). The command
writes `CINEMATIC-READINESS.json` and fails closed on missing concept, story,
narration, verification, critic, motion, audio, or authorship evidence. Require
`status: ready`, `ok: true`, and every gate to pass before Studio preview.

## Repair without lowering the floor

Use at most three bounded passes:

1. Repair responsible elements, scene code, typography, cue, or mix locally.
2. Repair the affected sequence and both transition boundaries.
3. Use at most one plan-level rework while preserving the selected concept,
   approved story, factual claims, and narration.

After each pass, rerun the failed local checks, render a fresh draft, refresh
the critic receipt, and rerun `cinematic-check`. Never delete assertions,
invent a `ship` verdict, suppress audio expectations, or lower motion thresholds
to obtain a pass. If readiness still fails, return `needs-repair` with the
remaining blocker and the preserved project. A readiness pass raises the craft
floor; it does not guarantee view count, distribution, or product-market fit.
