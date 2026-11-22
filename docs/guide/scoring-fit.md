# Learn from real results: the fitted layer

[`launchclip score`](scoring.md) tells you whether a hook breaks your rules. It cannot tell you whether a hook will perform. The fitted layer is a first step toward that: a small model that looks at posts with known results and learns which answers to your rubric's questions go with above-normal views.

Read these four points before you use it:

- **The model stays off until it beats chance on posts it has not seen.** Until then it is marked not usable, and predicting with it is refused.
- **It needs a few hundred posts with results.** Under 200 it is never usable. More is better.
- **Public view counts are a rough signal.** Views depend on follower count, posting time and paid promotion as well as the post itself.
- **A prediction is a starting guess.** When your own posts have real results, those results overrule it.

## What it trains on

A library of real posts, one JSON object on each line of `library.tagged.jsonl`:

```json
{"id": "abc", "account": "some-channel", "answers": {"names_audience": {"value": 0.91}, "hook_type": {"value": "number"}}, "outlier": 2.4}
```

- `answers` are the scorer's answers to your rubric's questions about the post.
- `outlier` is the post's views against its own account's median: 1 is a typical post, 2 is twice typical. A post with no `outlier` (too new, paid, or no baseline) is left out.
- `"own": true` marks your own posts, so they can count for more than competitors' posts.

## Fit and predict

There is no `launchclip` command for this yet. From JavaScript:

```js
import { runFit } from "launchclip/src/scoring/fit.js";

await runFit("fit", "library.tagged.jsonl", { out: "model.json", "own-weight": 3 });
await runFit("predict", "report.json", { model: "model.json" });
```

`fit` prints how the model did and saves it. For example:

```text
Fitted on 400 posts with results (folds by account, lambda 10).
On posts it had not seen: rank correlation 0.412 (95% range 0.327 to 0.491); shuffled results give 0.031.
Its predicted top quarter had 1.52 times the median result.
Usable: it beats chance on posts it had not seen.
Top features:
  +0.405  a higher strong_open goes with above-normal results
  +0.168  hook_type being "number" goes with above-normal results
These are associations in this library, not causes: a feature can go with good results without producing them.
Saved model.json.
```

`predict` takes the report from `launchclip score --out report.json` (scored with the same rubric as the library) and prints the items, best first:

```text
1.84x  top 6%  hook-3  Founders: your pricing page loses 4 in 10 visitors
0.71x  top 83%  hook-1  Hey guys, welcome back
```

`1.84x` means "predicted to do 1.84 times this account's typical post". `top 6%` places the item against the model's predictions for the posts it was trained on.

## How it decides it is usable

- The library is split into 5 parts. Each part is predicted by a model trained on the other 4, so every post is predicted by a model that never saw it. When there are at least 5 accounts, a whole account stays in one part, so the model cannot pass by memorising a channel.
- **Rank correlation** (Spearman) measures whether the posts it ranked higher did better: 0 is chance, 1 is a perfect ranking. The 95% range comes from resampling the posts 1,000 times.
- The same procedure is run on shuffled results, 5 times, as a check on what chance looks like for this library.
- The model is usable only when all three hold: at least 200 posts with results, the low end of the range is above 0, and it beats the shuffled runs. Otherwise `reasons` says which failed.

A usable model is still a weak one. A rank correlation of 0.2 means it is right a little more often than not.

## Limits

- It learns from the questions your rubric asks. If none of them matters to results, there is nothing to find.
- The top features are associations in your library, not causes. Changing a draft to gain a feature may not change its result.
- A linear model: it cannot learn that two features only work together.
- Roughly 1 library in 40 with no real signal will still pass as usable by luck. Refit when the library grows, and trust a result that holds.
- `predict --force` runs a model that is not usable. Its numbers are guesses.
