# Measure a scoring model before you trust it

`launchclip score` gates content on a decision model's answers ([scoring](scoring.md)). Before a gate drops anything on its say-so, check how often the model agrees with you. This is stage 0 of the scoring roadmap: label a set by hand, score it, compare.

## Label a set

A labelled set is a JSONL file, one item per line, with your answer to each rubric question:

```json
{"id": "h01", "kind": "hook", "text": "3 payroll mistakes that cost small business owners $2,000 a year.", "labels": {"names_audience": true, "concrete_detail": true, "clarity": 2, "hook_type": "number"}}
```

- `kind` decides which questions apply, exactly as it does when scoring (a question's `on`).
- A label answers the question as written, not whether the item passes. For `unsupported_claim`, `true` means the claim is there.
- Yes/no questions take `true` or `false`, a `choice` takes one option name, a `score` takes the level index (0 is the lowest level).
- You may leave a question out of a row. A label for a question the rubric does not ask of that kind is an error.
- A row with a `_comment` field is skipped. Other extra fields (a `note` on a borderline row) are ignored and never sent to the model.

How to label well:

- Label from the rubric's wording, before you look at any model's answers. Labels written after seeing the answers measure nothing.
- Use real items: hooks, covers, slides and scripts you made or collected, the bad ones included. Invented examples are too easy.
- Keep borderline cases in, and note why they are borderline. They are where models differ.
- If you cannot decide a label, the question is unclear. Fix the rubric rather than guessing.
- Aim for a mix: every question needs a fair number of both answers, or a model that always says "no" looks accurate.

`eval/fixtures/scorer-seed.jsonl` is a seed of 46 invented rows against the starter rubric. It proves the harness runs. Review its labels and extend it to about 200 rows of your own content before reading anything into the numbers.

## Run it

```bash
export OPENROUTER_API_KEY=...
npm run eval:scorer -- --set eval/fixtures/scorer-seed.jsonl --rubric docs/guide/scoring-rubric.json
npm run eval:scorer -- --set my-set.jsonl --rubric my-rubric.json --model typesafe/jev-1.13,another/model --out report.json
```

`--model` takes one id or several separated by commas; each is measured in turn and printed as its own table. Without it the rubric's `model` is used, then the default. `--out` writes every number, including a reliability table per question, as JSON. One request is made per row per model; the seed set costs about a tenth of a cent a model.

## Read the table

```text
typesafe/jev-1.13-20260917: 46 rows, 228 labels, 46 requests, cost $0.001349, median 3247 ms per request
question              n      agree     unsure  confident
names_audience       31        94%        13%       100%
opens_with_filler    31        87%         7%        93%
hook_type            31        84%         0%        84%
overall             228        93%         4%        95%
reliability, all gated questions (model's probability of a pass against the share the labels pass):
bucket                n  predicted   observed
0.0-0.2              52         5%         6%
0.4-0.6               8        47%        50%
0.8-1.0             123        97%        99%
```

- **agree**: the share of labels where the model lands on your side of the gate. For a yes/no question that is the same answer; for a score with `min`, the same side of `min`; for a choice with `allow`, the same side of the allowed list. A question that is only a tag (no `min`, no `allow`) agrees when it names your exact option or level.
- **unsure**: the share of answers between `1 - pass_at` and `pass_at`. These go to review instead of being decided, so a high figure means the gate saves you less work. An unsure answer never counts as agreeing.
- **confident**: agreement among the answers that were not unsure. This is the error rate of the gate itself: what gets passed or dropped without you seeing it. It matters more than `agree`.
- **reliability**: answers grouped by the model's probability of a pass, against how many of them your labels pass. In a calibrated model the two columns match: of the answers given about 75%, about three in four pass. If `observed` sits well below `predicted` in the top bucket the model is overconfident, so raise `pass_at`. Tags have no probability and are left out.
- **cost** and **median latency** cover the whole run. Latency is per request to the response headers, measured at the default 16 requests in flight, so it includes any queueing at the provider.

What to do with it:

- A question with low `confident` agreement is not ready to gate on. Reword it, tighten its criteria, or make it a tag.
- A question with high `unsure` and high `confident` is safe but slow. Lowering `pass_at` decides more; check the reliability table first.
- When two models are close, prefer the cheaper or faster one only if the gap is larger than the noise below.

## Why 40 rows is not enough

At 31 labels on a question, one label is 3 points, and the uncertainty is far wider than that: 28 of 31 correct reads as 90%, but the true rate could plausibly sit anywhere from about 75% to 97%. The slide-only question in the seed has 12 labels. A reliability bucket with 7 answers says almost nothing. Two models that differ by 5 points on 40 rows have not been told apart.

At about 200 rows, with each question labelled 100 times or more, the same 90% narrows to roughly 83% to 94%, and a 10-point gap between models is real. The seed is also invented by one person, with clear cases written to be clear, so it flatters every model. Until the set is your own content at that size, treat the table as a smoke test.
