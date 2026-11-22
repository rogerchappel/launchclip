# The hook funnel: write many, keep a varied few

One good hook is hard to write on demand. It is easier to produce a few hundred, throw out the ones that break your rules, and choose from a short list that covers different kinds of opening. The funnel does the first two parts. You do the choosing.

**The shortlist is a filter and a spread, not a ranking by quality.** The scorer can tell that a hook names its audience or opens with filler. It cannot tell which hook will do well. A person picks from the shortlist.

It builds on [scoring](scoring.md): the same rubric file, the same decision model.

## The steps

1. **Candidates.** Hooks are written by a fast writing model, assembled from parts with no model, or both.
2. **Score.** Every candidate is checked against the rubric. Each gets a status (`passed`, `review`, `failed`) and its tags, such as `hook_type`.
3. **Shortlist.** Failed hooks go. Hooks too close to your recent posts go. Near-duplicates of a hook already picked go. Of what is left, at most a few per hook type are kept, and a couple of wildcards are added.

## Running it

The funnel is a function for now, `runFunnel(target, flags)` in `src/scoring/funnel.js`; it has no command yet.

```js
import { runFunnel } from "launchclip/src/scoring/funnel.js";

const summary = await runFunnel("marathon training for first-timers", {
  count: 200,
  recent: "recent-hooks.txt",
  out: "funnel"
});
console.log(summary.counts, summary.seconds, summary.cost_usd);
```

`target` is a topic, or a brief file. With a brief file the first line is the topic and the whole file is given to the writer and the scorer.

| Flag | What it does | Default |
| --- | --- | --- |
| `count` | How many hooks to write (and to assemble, with `assemble`). | 200 |
| `assemble` | A parts file. Hooks are assembled instead of written. Pass `count` as well to do both. | none |
| `rubric` | The rubric file. | the starter rubric, `docs/guide/scoring-rubric.json` |
| `recent` | A text file of your earlier hooks, one a line. | none |
| `per-type` | How many hooks to keep of each type. | 3 |
| `wildcards` | How many wildcards to add. | 2 |
| `model` | The writing model, as `provider:model`. | `LAUNCHCLIP_MAKE_MODEL` |
| `scorer-model` | The decision model. | the rubric's, else the scorer's default |
| `seed` | Any text. The same seed gives the same assembled hooks and the same wildcards. | empty |
| `out` | The folder the files go in. | `funnel` |

Scoring needs `OPENROUTER_API_KEY`. Writing needs the key for the writing model's provider.

## What it writes

| File | Holds |
| --- | --- |
| `candidates.jsonl` | Every candidate, one a line: `{id, kind, text, source}`. `source` is `written` or `assembled`. |
| `scored.json` | The scoring report: every candidate with its status, answers and tags. |
| `shortlist.txt` | The shortlisted hooks, one a line. This is the file to read. |
| `shortlist.json` | The shortlist with each hook's type and answers, wildcards marked `"wildcard": true`, and the ids of what was dropped and why. |

The summary it returns has the counts at each step, the seconds each step took, and the cost of writing and of scoring.

## Writing

Use a small, fast model. The hooks are asked for in batches of 25, several batches at once, and each batch is told to lead with something different: a number, a mistake, a contrarian claim, a moment from a story, a question with stakes, and so on. Without that, parallel batches write the same hooks. Exact duplicates are dropped, so you can get slightly fewer than you asked for. A batch that fails is left out and listed under `warnings` in the summary.

## Assembly

Assembly needs no model and makes thousands of candidates in under a second. A parts file is JSON:

```json
{
  "openers": ["{number} mistakes {audience} make with {topic}", "{audience}: {topic} can {payoff}"],
  "audiences": ["new runners", "busy parents"],
  "numbers": [3, 5, 7],
  "topics": ["sleep", "pacing"],
  "payoffs": ["cut your injury risk"]
}
```

An opener is a template. Its slots are `{audience}`, `{number}`, `{topic}` and `{payoff}`, and it need not use them all. Each hook is one opener with a value drawn for each slot, and no hook is made twice. There is a fuller example in [scoring-hook-parts.json](scoring-hook-parts.json).

Assembled hooks read like templates because they are. They are useful for finding which combinations of angle, audience and payoff pass your rubric, and as raw material to rewrite.

## How the shortlist is chosen

- **Failed** hooks are out. Hooks marked `review` (the scorer was unsure about a question) stay in.
- **Close to a recent post**: a hook that shares most of its content words with a line in the `recent` file is out. It is the same measure, and the same limit of 0.6, that `launchclip history check` uses for repeated hooks.
- **Near-duplicates**: a hook that close to one already picked is out.
- **A quota per type**: at most `per-type` hooks for each value of the `hook_type` tag. Within a type, hooks with fewer unsure answers come first, then those the scorer was more confident pass. Taking the overall top instead would give you a list that all sounds alike, because one scorer has one taste.
- **Wildcards**: `wildcards` more hooks, drawn by the seed from the ones the quota left out. They passed the rubric but were not chosen by score. They are there so the scorer's preferences are not the only ones on the list.

The quota needs a tag to work with. If your rubric has no `hook_type` question, every hook counts as one type and you get `per-type` hooks plus the wildcards.

## Limits

- The order within the shortlist means little. Do not read the first hook as the best.
- Similarity is word overlap. Two hooks that say the same thing in different words both get through.
- Assembly only recombines what is in the parts file.
- The writing cost is the figure the router reports; a provider that reports none shows as 0.
