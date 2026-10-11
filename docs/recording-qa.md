# Post-render recording QA

A rendered edit needs fresh evidence. The recording QA stage compares an independent word-timed transcription of the exported media with the intended edit, inspects acoustic joins, and requires semantic coherence coverage before reporting `passed`.

`assessRecordingQa(plan, renderedTranscript, options)` returns schema `launchclip.recording-qa.v1`, status, transcript/acoustic/coherence checks, issues, and guarded repair requests. Status is `passed`, `repair-needed`, `needs-semantic-review`, or `needs-attention`.

Recognition substitutions and omissions are ambiguous. Punctuation/case variation is normalized and word sequences are aligned, with disagreements near boundaries located for inspection. An ASR disagreement alone never authorizes a physical repair. Acoustic clipping must be independently proven. A bounded `expand-boundary` request refers to a segment, edge, and maximum 0.2-second expansion; the separate repair engine must prove the expansion safe against original source words and rejected takes/fillers.

## Semantic coverage

Use `identifyRecordingCoherence(plan, renderedTranscript, {mediaSha256, decisions})` with an active-agent receipt, or explicitly select `{model, baseUrl}` for local Ollama. The built-in adapter accepts only loopback endpoints, refuses redirects, and has no metered-model fallback. The injected `infer` adapter is available for integrations and tests.

A receipt has this contract:

```js
{
  evidence_hash: recordingQaEvidenceHash(plan, renderedTranscript, mediaSha256),
  coverage_complete: true,
  findings: [],
  transcript_resolutions: []
}
```

Hash the actual rendered media bytes with SHA256. Binding includes the entire plan and normalized output words. If original source context is supplied, pass it as `sourceTranscript` to identification/assessment, and as the fourth argument to `recordingQaEvidenceHash`; the source is then also bound. Stale receipts fail closed. The model response receives its evidence hash locally rather than calculating it.

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

A proven acoustic issue uses `{kind:'clipped-boundary', segment_index, edge:'start'|'end', seconds, proven:true, explanation}`. Without complete acoustic and semantic coverage the edit cannot pass. CLI runs without an installed local model stage an agent review and remain pending; the active subscription agent must complete and supply the bound receipt. Do not replace missing coverage with an empty fabricated pass.

Every repaired render changes the evidence. Transcribe and inspect the new export again, then obtain a fresh semantic receipt. Preserve media and QA receipts for each iteration. This module does not publish, delete source footage, or silently rewrite speech.
