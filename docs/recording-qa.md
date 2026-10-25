# Post-render recording QA

A rendered edit needs fresh evidence. The recording QA stage compares an independent word-timed transcription of the exported media with the intended edit, inspects acoustic joins, and requires semantic coherence coverage before reporting `passed`.

`assessRecordingQa(plan, renderedTranscript, options)` returns schema `launchclip.recording-qa.v1`, status, transcript/acoustic/coherence checks, issues, and guarded repair requests. Status is `passed`, `repair-needed`, `needs-semantic-review`, or `needs-attention`.

Recognition substitutions and omissions are ambiguous. Punctuation/case variation is normalized and word sequences are aligned, with disagreements near boundaries located for inspection. An ASR disagreement alone never authorizes a physical repair. Acoustic clipping must be independently proven. A bounded `expand-boundary` request refers to a segment, edge, and maximum 0.2-second expansion; the separate repair engine must prove the expansion safe against original source words and rejected takes/fillers.

## Semantic coverage

Use `identifyRecordingCoherence(plan, renderedTranscript, {mediaSha256, decisions})` with an active-agent receipt, or explicitly select `{model, baseUrl}` for local Ollama. The built-in adapter accepts only loopback endpoints, refuses redirects, and has no metered-model fallback. The injected `infer` adapter is available for integrations and tests.

A receipt has this contract:

```js
{
  evidence_hash: recordingQaEvidenceHash(plan, renderedTranscript, mediaSha256, sourceTranscript, acoustic),
  coverage_complete: true,
  findings: [],
  transcript_resolutions: [],
  acoustic_resolutions: []
}
```

Hash the actual rendered media bytes with SHA256. Binding includes the entire plan and normalized output words. If original source context is supplied, pass it as `sourceTranscript` to identification/assessment, and as the fourth argument to `recordingQaEvidenceHash`; the source is then also bound. Pass the measured acoustic snapshot as the fifth hash argument; identification and assessment bind `options.acoustic` automatically. Stale receipts fail closed. The model response receives its evidence hash locally rather than calculating it.

Findings include `kind`, `start_seconds`, `end_seconds`, and `explanation`, with optional `segment_index` and `edge`. Blocking kinds are `broken-sentence`, `missing-context`, `orphan-fragment`, `unintended-repetition`, and `unclear-audio`. `source-delivery` and `transcription-variation` are nonblocking observations. Original informal grammar is not automatically an editing defect. Semantic findings cannot declare themselves repairable or execute edits.

Explicit `transcript_resolutions` entries use `{issue_index, verdict:'asr-variation', explanation}`. An evidence-bound reviewer may resolve a recognition disagreement after audition or source comparison; unexplained differences stay ambiguous. A hash binds evidence, but cannot prove the reviewer's judgment correct.

Assessment options:

```js
{
  mediaSha256,
  semantic: receipt,
  acoustic: {checked: true, issues: []},
  sourceTranscript // optional original word-timed transcript
}
```

An unproven `join-click-candidate` stays ambiguous. A bound semantic receipt may resolve it with `acoustic_resolutions:[{issue_index,verdict:"natural-transition",explanation}]` after audition; unresolved candidates prevent passing. A matching original word whose original timestamp crosses a cut, together with an independent output-ASR disagreement at that boundary, permits a small source-word restoration request; the repair engine still checks protected removed ranges.

A proven acoustic issue uses `{kind:'clipped-boundary', segment_index, edge:'start'|'end', seconds, proven:true, explanation}`. Without complete acoustic and semantic coverage the edit cannot pass. CLI runs without an installed local model stage an agent review and remain pending; the active subscription agent must complete and supply the bound receipt. Do not replace missing coverage with an empty fabricated pass.

Every repaired render changes the evidence. Transcribe and inspect the new export again, then obtain a fresh semantic receipt. Preserve media and QA receipts for each iteration. This module does not publish, delete source footage, or silently rewrite speech.

## Consensus word timing

Cut quality depends on word timing, and one recogniser is not enough: `base.en` can time a first word too early, starting it inside a rejected word's tail; `small.en` can drop words, or give them no duration. `edit-recording` therefore transcribes the source with two local Whisper models by default (`--recording-model base.en`, `--consensus-model small.en`) and merges them word by word with `mergeConsensusTranscripts(primary, secondary, {models, levels})`:

- The word sequences are aligned. A word either model heard is kept, with that model's own timing; a word with no valid duration from either is not kept.
- Each matched word's start and end are compared separately. Within the tolerance (0.08 s) they agree and the primary edge is used.
- A wider disagreement goes to the measured 10 ms RMS envelope of the source (`measureFrameLevels`, one streaming local FFmpeg pass): the start whose level rises more across a 50 ms probe either side wins, and the end whose level falls more. Without a 3 dB margin, the primary edge stays.
- A wording disagreement keeps the primary word. A single-model word that would overlap a kept neighbour is not kept rather than retimed.

Every timing is one recogniser's own edge; nothing is interpolated. The merged transcript is `source-transcript.json`, with the receipt under `consensus`; both raw transcripts are in `consensus-inputs.json`. The plan carries the disagreements as `transcript_consensus`, and QA lists the unsettled ones on retained speech (wording, a word only one model heard or timed, a dropped overlap, and timings the envelope could not separate) as nonblocking `recogniser-disagreement` issues, located on the edit timeline. The independent transcription of the rendered edit still gates the result as before.

`--consensus-model none` returns to a single model. A supplied `--recording-transcript` is used alone unless `--consensus-transcript` supplies the second word-timed transcript. The second model costs a second local transcription, and its first run may download weights; no paid provider is called.

## Word timestamps that swallow a retake tail

A recognizer can assign the first chosen word a timestamp that includes a short
signal from the rejected take, followed by a long quiet pause. Matching output
ASR does not prove that this retained head is clean.

Waveform refinement records `audio_analysis.ambiguous_word_spans` when a
retake-facing first word lasts at least 0.8 seconds and contains at least 0.4
seconds of measured interior quiet beginning within 0.2 seconds of its start.
It preserves the timed word and speech ranges. These conservative thresholds
identify uncertainty; they are not a voice-activity classifier or a deletion
rule. Ordinary interior pauses away from rejected cuts are unaffected.

QA appends the span as an unconfirmed acoustic boundary after existing measured
issues. A matching transcript or an otherwise empty semantic assessment cannot
pass it. An active agent or explicitly selected local model must inspect the
source and rendered boundary and independently align the chosen speech before
providing an evidence-bound acoustic resolution. The review may identify natural
delivery instead of a retake artifact. The flag itself authorizes no speech
removal or boundary contraction; the one automatic exception is the guarded
contraction below, and a contracted keep is not flagged.

## Guarded rejected-tail contraction

A recogniser can end a rejected word too early and start the chosen word too
early, so the keep opens on the rejected word's audible tail. Waveform
refinement contracts such a keep only when all of these hold:

- **The envelope proves a tail.** The 10 ms source levels (`tail_windows`, measured
  with the consensus pass) show voice continuing across the cut at least 6 dB above
  the boundary threshold, never louder than at the cut, never re-rising more than
  12 dB over its decayed level (a 30 ms running maximum), and falling into at least
  40 ms of measured quiet within 0.4 s.
- **An independent alignment puts the chosen word after it.** The plan's first kept
  word starts inside the tail, and another recogniser times the same word, before
  the next kept word, starting at or after the tail's quiet.
- **No retained word overlaps** the removed region.

The keep then starts in that quiet, at most `silencePadding` before the chosen
word, and the word takes the independent start (its own end is kept unless it
ends before that start). The removed range is `rejected-speech-tail`, which a
QA repair can never expand back into. `audio_analysis.tail_contractions` records
the proof (cut level, quiet span, both word starts and the independent model),
and QA lists each one as a nonblocking `rejected-tail-contraction` issue on the
edit timeline. Without every proof the boundary stays as it was and the
unconfirmed-boundary review above applies. A single-recogniser run has no
independent alignment, so it never contracts.
