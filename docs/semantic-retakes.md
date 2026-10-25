# Paraphrased restarts

Launch Clip's optional semantic stage detects nearby passages that repeat the same information with different wording. The last take always wins. It does not rank delivery or require a take-selection interface. Literal matching remains available without a model.

`identifySemanticRetakes(transcript, options, adapters)` returns `{transcript_hash, retakes, restarts, removals}` using **original normalized word indices and source timestamps**. Run it before fillers or silence change word timing. Pass its `retakes` to the recording edit engine as `semanticRetakes`, with the same `retakeWindow` (90 seconds is the semantic default).

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
  semanticRestarts: result.restarts,
  retakeWindow: 90,
});
```

## Restarts inside a sentence

A retake replaces a whole passage. A speaker also restarts inside a sentence: "but however, but whatever comes next", "you get actual code templates, you get actual code templates and tools", "less consuming, shipping, more shipping". The same receipt carries these as word-level `restarts`, with the same rules: inclusive original word indices, the later complete restatement wins, the transcript hash binds the receipt, and invalid decisions fail closed.

```json
{
  "transcript_hash": "…",
  "retakes": [],
  "restarts": [
    {
      "earlier": { "first_word": 23, "last_word": 23 },
      "later": { "first_word": 24, "last_word": 25 },
      "later_complete": true,
      "explanation": "'shipping' is abandoned and restated as 'more shipping'."
    }
  ]
}
```

A restart need not sit on a passage boundary, but each range stays inside one passage from `indexedPassages`. The earlier range is at most 12 words. The restatement starts immediately after it (only filler words such as "um" may sit between), within 3 seconds, and has at least two words. Overlapping restarts and a restart that removes another restart's restatement are rejected: write a chain ("we help, we help teams, we help teams ship") as one earlier range. Repeated decisions for the same earlier range keep the longest restatement. A restart may clean a retained retake's later passage. `restarts` is optional in supplied receipts; local models are asked for both arrays. Pass `result.restarts` to the edit engine as `semanticRestarts`; the cut reason is `semantic-restart`, and QA repairs never expand a boundary back into it.

Two lexical rules need no model. A short exact run of fewer than `minRepeatWords` (default 6) words, at least two of them distinct, immediately restated word for word, is cut when the abandoned run sits inside one sentence and the restatement continues past it ("you get, you get actual feedback"). A sentence that ends on the repetition ("it works every time, it works every time.") and a single doubled word ("very very") stay. A repeated connective launch ("but however, but") is cut after a sentence end, a long pause or a clause comma. Both rules record `false-start` cuts.

Validation rejects missing decisions, malformed or out-of-bounds indices, partial passage boundaries, earlier/later overlaps, distant repetitions, missing completeness assertions, and conflicting removals. Exact A → B → C chains are allowed; the terminal last take must survive. Repeated decisions for the same earlier range retain the latest replacement. Only the edit engine changes physical media ranges and remaps timing.

The model determines semantic equivalence and completeness; structural validation cannot prove those judgments. Transcription errors, ambiguous summaries, and weak models may create false positives or miss restarts. Preserve the original footage and cut log, and audition automated output before publishing. The prompt and fixtures use general restart rules and invented examples, with no project-specific transcript rules.
