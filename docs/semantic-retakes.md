# Paraphrased restarts

Launch Clip's optional semantic stage detects nearby passages that repeat the same information with different wording. The last take always wins. It does not rank delivery or require a take-selection interface. Literal matching remains available without a model.

`identifySemanticRetakes(transcript, options, adapters)` returns `{transcript_hash, retakes, removals}` using **original normalized word indices and source timestamps**. Run it before fillers or silence change word timing. Pass its `retakes` to the recording edit engine as `semanticRetakes`, with the same `retakeWindow` (90 seconds is the semantic default).

There are two inference paths:

- Supply `options.decisions` from your current subscription agent or another analysis tool. This performs validation without a network call.
- Explicitly select `options.model` to use an installed local Ollama model. The default endpoint is `http://127.0.0.1:11434`; the built-in adapter only accepts loopback URLs and refuses redirects. This stage has no automatic paid-model route. Tests and integrations can inject `adapters.infer`.

## Decision contract

```json
{
  "transcript_hash": "SHA256 of normalized original transcript words",
  "retakes": [
    {
      "earlier": { "first_word": 0, "last_word": 4 },
      "later": { "first_word": 9, "last_word": 14 },
      "later_complete": true,
      "explanation": "The later passage replaces the same earlier information."
    }
  ]
}
```

Supplied decisions must include `transcript_hash: semanticTranscriptHash(originalTranscript)`. The hash includes wording and word timing; receipts from another transcript fail closed. Local model responses need only the retakes array; the inference adapter attaches the original transcript hash itself.

Indices are inclusive and refer to `normalizeRecordingTranscript(originalTranscript)`. Use `indexedPassages(words)` to obtain allowed passage boundaries. A range may span several consecutive clauses or sentences. Mark only earlier repeated words; unique intervening passages stay in place. Return an empty `retakes` array when uncertain.

```js
const result = await identifySemanticRetakes(originalTranscript, {
  durationSeconds,
  decisions: agentDecisions,
  retakeWindow: 90,
});
const plan = planRecordingEdit(originalTranscript, {
  durationSeconds,
  semanticRetakes: result.retakes,
  retakeWindow: 90,
});
```

Validation rejects missing decisions, malformed or out-of-bounds indices, partial passage boundaries, earlier/later overlaps, distant repetitions, missing completeness assertions, and conflicting removals. Exact A → B → C chains are allowed; the terminal last take must survive. Repeated decisions for the same earlier range retain the latest replacement. Only the edit engine changes physical media ranges and remaps timing.

The model determines semantic equivalence and completeness; structural validation cannot prove those judgments. Transcription errors, ambiguous summaries, and weak models may create false positives or miss restarts. Preserve the original footage and cut log, and audition automated output before publishing. The prompt and fixtures use general restart rules and invented examples, with no project-specific transcript rules.
