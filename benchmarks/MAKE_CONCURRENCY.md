# What overlapping work changes in `launchclip make`

```bash
node benchmarks/make-concurrency/run.mjs [--call-ms 400] [--still-ms 100] [--json]
```

A recorded run: the model's answers are fixed
(`test/helpers/make_recorded_run.js`), and every model call and every
candidate still takes a set time. No model, voice or renderer is called, so
the only thing that differs between two columns is what runs at the same
time. Read the table as "which stages can get shorter, and by what share",
not as seconds a real run takes: a real call takes tens of seconds, and its
length varies.

The script runs each brief at `--model-concurrency 1 --concurrency 1` and at
`--model-concurrency 4 --concurrency 2`. The "before" column below is the
same script run against `main` (1504171b), where every call and every still
ran one after another.

## 2026-11-10, model call 400 ms, still 100 ms

A prompt and one clip (13 model calls: one description, concept, judge,
story, edit, script, two direction calls, two storyboard calls, the second
opening and two judges):

| stage | before (s) | overlapping (s) | change |
|---|---|---|---|
| inventory | 0.4 | 0.4 | 0% |
| prepare (concept, story, script, voice) | 2.1 | 2.0 | 0% (noise) |
| storyboard | 1.6 | 1.6 | 0% |
| candidates | 2.4 | 1.8 | −25% |
| total | 6.6 | 5.9 | −11% |

The same with six screenshots handed in (19 model calls, 7 of them beside
another, 4 at most at once):

| stage | before (s) | overlapping (s) | change |
|---|---|---|---|
| inventory | 2.8 | 0.8 | −71% |
| prepare (concept, story, script, voice) | 2.1 | 2.0 | 0% (noise) |
| storyboard | 1.6 | 1.6 | 0% |
| candidates | 2.4 | 1.8 | −25% |
| total | 9.0 | 6.3 | −30% |

What the numbers say:

- **prepare and storyboard do not move.** Their calls are a chain: each one's
  input is the one before's answer (docs/guide/headless.md, "What runs at the
  same time"). Running things at the same time cannot shorten a chain.
- **inventory** shortens with the number of files: seven descriptions in two
  waves of four instead of seven in a row.
- **candidates** loses one candidate's render per comparison: the planner's
  opening renders under the design call, and the two transitions render
  together. With `--concurrency 1` only the first of those applies (2.1 s).
