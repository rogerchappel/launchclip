# Recorded presenter video

Use this route for an existing recording with automatic base editing, B-roll
planning or basic editorial graphics. Preserve the story and the original file.
Read `standalone-hyperframes.md` before authoring the composition; no additional
HyperFrames plugin skills are required.

## Automatic base edit

When cleanup is requested, run the local CLI:

```bash
launchclip edit-recording recording.mov --out .launchclip/recording-edit --aspect 16:9
```

This defaults to local Whisper (`base.en`, configurable with `--recording-model`)
and calls no paid model or transcription provider. Whisper must already be
installed; its first run can download the selected model. Reuse a word-timed
JSON transcript with `--recording-transcript words.json` to avoid transcription.
Supported inputs include flat words, `{words}` and Whisper segments containing
word arrays. Plain text or segment-only timestamps are insufficient for cuts.

The deterministic policy is **last take wins**: remove earlier nearby repeated
lines/passages and matching unfinished prefixes, retaining the final occurrence.
Do not rank performances or ask the user to select takes. Preserve unique speech
in source order. For reworded restarts, first use the active agent to compare
nearby complete passages in the original normalized transcript. Follow the
generic receipt contract in `docs/semantic-retakes.md`: compute its transcript
hash, use original inclusive word indices, keep the later complete restatement,
and leave uncertain or intentionally contrasting statements alone. Save decisions
outside the repository and pass `--retake-decisions retakes.json` with the same
`--recording-transcript` file. Decisions are automated; no take-selection gate.
Standalone CLI users can instead explicitly select an installed local Ollama
model with `--retake-model MODEL`. No paid fallback occurs. Without either option,
the CLI applies lexical matching only; it cannot detect arbitrary paraphrases.

The transcript-gap fallback uses 0.8s gaps with 0.15s speech handles. Use
`--silence-duration`, `--silence-padding`, `--retake-window` (90s), and
`--min-repeat-words` (6) when the recording needs different thresholds.
`--no-trim-silence` preserves pauses while still applying last-take cleanup.
Recognized hesitation tokens and abandoned connective starts are removed by
default; grammatical uses of “but” and “like” remain. `--keep-fillers` disables
this. Whisper may omit audible hesitations even with a verbatim prompt; the tool
cannot cut a filler whose word timing is absent. Check the source audio.

Local FFmpeg also measures a bounded RMS waveform and adaptive quiet threshold.
It controls pause removal instead of pre-cutting transcript gaps, so inaccurate
ASR timing cannot discard voiced gaps. It trims measured quiet outside spoken
words, retaining 0.08s handles and
protecting quiet speech. Defaults use a 0.4s acoustic pause minimum; configure
`--audio-silence-duration`, `--audio-silence-padding`, or an explicitly inspected
`--audio-threshold-db`. `--no-audio-silence` disables acoustic trimming.
`audio-analysis.json` explains the measured threshold and stores the waveform;
`semantic-retakes.json` records the applied decisions.

Preserve source dimensions and playback speed; do not apply the older portrait
presenter crop/speed defaults.

Outputs include `base-edit.mp4`, original transcript, edited transcript/words,
an original-to-edited segment map, and `recording.json` provenance/cache receipt.
Inspect failures and verify cuts locally without adding a take-selection gate.
Zero-duration transcription artifacts are discarded rather than assigned fake
timing. Transcription errors can affect cuts and graphics; check actual footage
when correcting visible text. Never invent replacement word timestamps.

Identical reruns reuse verified edit artifacts and preserve capture progress.
Changed input/settings/engine or an incomplete prior export requires a fresh
output directory; do not overwrite an existing base edit. Temporary rendering
segments need disk space and are cleaned after success or failure.

## Automatic QA and bounded repairs

Base editing includes post-render QA. The active agent owns the semantic check;
this is an automated stage, not a request for human take selection.

1. Render a candidate, then independently transcribe its actual audio with local
   Whisper. Source word remapping alone is not final-video evidence.
2. Inspect every audio join in bounded PCM batches. Compare the intended words
   with the fresh transcript; ASR differences alone do not prove a bad cut.
3. Assess continuity, unique context, orphan fragments and repetition against
   the rendered transcript, source words and join evidence. Distinguish source
   delivery and recognition errors from problems introduced by editing.
4. Restore proven clipped retained-word boundaries within the repair budget,
   then render and recheck. Never restore a rejected take or filler, invent
   speech, or delete a complete unique word to make the transcript look cleaner.
5. Publish `base-edit.mp4` and B-roll timings only after QA passes. Default maximum
   is three rendered attempts (`--qa-attempts`, capped at five). Total boundary
   recovery is capped at 0.6s across retries, and 0.2s per repair.

Outer frames are trimmed to the chosen voiced word boundaries. Wordless islands
are removed throughout the edit, including tiny remnants between rejected takes.
Genuine short words are preserved; there is no blanket minimum clip duration.
Handles directly facing rejected takes or fillers prefer the nearest verified
quiet separator fully outside accepted words, within the original retained range
and at most 500ms from the aligned word boundary. Cuts land inside that gap with
padding clamped to half its duration; without a qualifying separator they fall
back to aligned word bounds for legacy analysis. New analysis uses a separate
noise-relative cutoff (noise floor + 6dB, never above the dialogue cutoff and
bounded below at -80dB), requiring 40ms sustained quiet without debounce. If no
separator qualifies, it preserves the original handle and records an unconfirmed
boundary for source/output QA instead of claiming clean audio. The initial cut
search is distinct from QA restoration budgets: repairs remain capped at 200ms
each and 600ms total. The normal 0.4s acoustic pause minimum remains unchanged. This removes
residual audio even when ASR does not recognize a word. These
removed handles are protected from later QA restoration. PCM join checks detect
isolated click candidates; they do not establish that every sustained phoneme or
breath is correct. Inspect source/output audio context for suspicious residue and
leave ambiguous sound findings unresolved rather than claiming clean audio from
transcript agreement alone.

With the active-agent route, an initial `needs-semantic-review` result is a
checkpoint for the agent to continue automatically. Read its saved candidate,
actual `rendered-transcript.json`, `plan.json`, `joins.json`, QA issues and source
context. Use the CLI package's `recordingQaEvidenceHash(plan, actual, mediaSha256,
sourceTranscript, acoustic)` helper and the receipt contract in
`docs/recording-qa.md`. Save each complete review in a local
`{ "reviews": [receipt] }` JSON file, then rerun the same command with
`--qa-decisions reviews.json`. Candidates are checksum-verified and reused;
new attempts need new evidence-bound reviews. Preserve earlier review receipts.

Assess every disagreement individually. Never blanket-resolve an omitted word,
mark semantic coverage complete from timing tests, or turn an unresolved
sound/coherence problem into a nonblocking source-delivery note. Compare short
source/output windows when the word boundaries are uncertain. If evidence cannot
support a safe correction, retain the timed `needs-attention` report.

Standalone CLI users can explicitly select an installed local Ollama model with
`--qa-model MODEL` for the semantic pass; `--qa-recording-model` configures local
final-video Whisper separately. There is no implicit paid provider, model install,
or metered fallback. Without a model or bound agent receipt, semantic QA stays
pending and `base-edit.mp4` is withheld. This is model work pending, not human
approval pending. Production stops before downstream stages until it is resolved.

Every candidate, independent transcript, measured join, review and repair remains
in `qa/attempt-N/` with `qa/session.json`. Ready outputs include
`rendered-transcript.json` and `recording-qa.json` beside the intended transcript
and edit map. Existing exports require a new directory after this engine update.

## B-roll capture and placement

Editing also writes `broll-plan.json` and `BROLL.md`. For an already clean video:

```bash
launchclip broll-plan edited-transcript.json --out .launchclip/captures --aspect 16:9
```

The offline planner suggests practical software/product shots using topic
keywords. Each card has a spoken anchor, edited timeline, capture instructions,
priority, stable filename, status and optional `media_path`. Suggestions are not
proof that a referenced tool, screen or result exists. For unmatched subjects,
author specific cards from the actual transcript rather than generic filler.

Record about 12 seconds per shot, with a settled beginning/end, readable UI,
deliberate cursor movements, and no private notifications or credentials.
Track `planned`, `recorded`, `approved`, `placed`; attach a real local path in
`media_path`. Reruns preserve JSON statuses/paths and Markdown notes. A changed
transcript/timeline requires a new tracker directory to avoid stale placements.

The planner does not record screens, generate stock video, or automatically
insert captures. Once footage is supplied, inspect it and mount selected windows
using the existing root media contract (`data-start`, `data-duration`,
`data-media-start`). Continue the cleaned presenter audio once at the root;
mute B-roll unless its audio is deliberately needed. The CLI production lane
accepts captures as `--resource` / `--assets` and can assemble per-shot source
windows through `root_media_requests`.

## Editorial glass treatment

When this style is requested, define it in the project's `DESIGN.md` and honor
an existing project style pack first. Use a restrained system:

- Short editorial phrases, a presenter lower-third, occasional key-point
  cards, a relevant callout and a closing invitation grounded in speech.
- Dark translucent panels, subtle light borders, restrained shadow, one accent
  colour, and clear type hierarchy. Keep panels outside the face/gesture area.
- Small translation plus opacity, about 0.4–0.5s on entry and 0.25–0.35s on exit,
  with smooth ease-in/ease-out (`power2.inOut` is a useful starting point).
  Avoid bounce, overshoot, continuous pulsing and unnecessary camera motion.
- If using backdrop blur, verify it in the encoded frame over actual footage.
  Native video compositing can behave differently from Studio. A sufficiently
  opaque tint must keep text readable even when background blur is unavailable.
- Anchor motion to edited words, allow enough dwell time to read, and leave
  sections without overlays. Do not force cinematic register counts or a sound
  on every card for a basic editorial treatment.

Prove the treatment on a short section before expanding it. B-roll should
support the spoken idea or cover a join; it need not replace every talking-head
section. Build all timings from the accepted automated base edit, not the raw
recording. Music and SFX remain optional choices; no paid provider calls are
implied by this route.

## Verification and delivery

Run HyperFrames lint/check, inspect snapshots and encoded entry/settle/exit
frames, and verify actual duration, dimensions, audio sync and readable safe
areas. Confirm the original is unchanged. Preview the completed treatment for
final export approval. Do not require a take-selection review or generate fake
concept/story receipts merely to satisfy cinematic checks: `cinematic-check`
belongs to the full cinematic workflow, not this basic editorial route.
