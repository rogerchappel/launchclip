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
candidate order. Save candidates, scores, penalties, required improvements,
and `selected_id` in `CONCEPTS.json`. Do not choose by taste after scoring.

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

## Time the real narration before the edit

Prepare narration before final storyboard timing:

1. Use supplied speech, an explicitly approved voice provider, an approved
   local/system voice, or an intentionally unnarrated edit.
2. Probe the actual audio duration and derive word timings locally when speech
   exists.
3. Record word timing, pauses, beat boundaries, source, delivery direction, and
   measured duration in `NARRATION.json`.
4. Build the final edit grid and shot boundaries from that measured performance.

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
audio, payoff, and mobile readability. Save strict JSON at `qa/critic.json`:

```json
{ "verdict": "ship", "findings": [], "summary": "Fresh-context review." }
```

Use `repair` or `replan` and actionable findings when it is not ready. Then run
the model-free local gate from a LaunchClip checkout or installed CLI:

```bash
launchclip cinematic-check <project> \
  --video renders/draft.mp4 \
  --critique qa/critic.json \
  --expect-audio \
  --audio-manifest AUDIO-MANIFEST.json
```

Omit the two audio flags only when audio is intentionally absent. The command
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
