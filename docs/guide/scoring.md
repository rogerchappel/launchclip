# Score hooks, scripts and slides against your own rules

`launchclip score` asks a fast decision model a list of closed questions about every hook, script or carousel slide you give it, and tells you which ones break your rules. It is a check, not a judge of quality: it can tell you a hook names no audience, and it cannot tell you a hook will perform. See the [scoring roadmap](../SCORING_ROADMAP.md) for what is planned on top of it.

## What you need

- An OpenRouter key in `OPENROUTER_API_KEY`. Scoring 1,000 short items costs a few cents.
- A rubric: a JSON file of questions. Start from [`scoring-rubric.json`](scoring-rubric.json).

## Score a list of hooks

Put one hook on each line of a text file, then:

```bash
launchclip score hooks.txt --rubric rubric.json --passed shortlist.txt
```

```text
FAIL    hook-2  "Hey guys, welcome back to the channel"
        failed: names_audience (0.13), concrete_detail (0.03), opens_with_filler (0.02)
3 scored with typesafe/jev-1.13-20260917: 1 passed, 0 to review, 2 failed. Cost $0.0001.
```

The number after each question is the probability the item passes it. `--passed` writes the hooks that passed every question, one a line. `--out report.json` writes every answer, and `--json` prints it. The command exits 1 when anything fails.

## Score a project

```bash
launchclip score my-carousel
```

A project folder is scored from its own files, with `rubric.json` in the folder as the rubric:

| In the project | Scored as |
|---|---|
| A carousel's first slide | `cover` |
| Its other slides | `slide` |
| The first sentence of `SCRIPT.json` | `hook` |
| The whole script | `script` |

A script file on its own (`SCRIPT.json`, `NARRATION.json`, a video's `storyboard.json`) gives the same `hook` and `script`. A `.json` or `.jsonl` list holds strings or `{"text": "...", "id": "...", "kind": "..."}`.

## Write a rubric

```json
{
  "pass_at": 0.7,
  "questions": {
    "names_audience": {
      "type": "noul",
      "on": ["hook", "cover"],
      "instructions": "Does the text say who it is for, by naming a kind of person, role or situation?",
      "criteria": { "true": "A reader can tell who is being addressed.", "false": "It could be addressed to anyone." }
    }
  }
}
```

| Type | Asks | Passes when |
|---|---|---|
| `noul` | A yes/no question | Yes is likely. Add `"want": false` when yes is the failure (a banned claim) |
| `score` | A rating on levels you describe, lowest first | The level is likely at or above `"min"` |
| `choice` | One option from a list | The pick is likely one of `"allow"` |

- A `choice` with no `allow`, or a `score` with no `min`, is a **tag**: it is recorded in the report and never fails anything. Use tags to label hooks by type or angle.
- `on` limits a question to some kinds of item. Leave it out to ask it of everything.
- `pass_at` (default 0.7) is how sure the model must be. A question passes at or above it, fails at or below `1 - pass_at`, and is marked **review** in between, for you to look at.
- Write the whole question in `instructions`. The model never sees the question's key.
- Ask narrow questions with one answer each. "Is this a good hook?" gives noise; "Does it state a number?" gives a check.

## Options

| Option | What it does |
|---|---|
| `--rubric <file>` | The rubric. A project folder defaults to its own `rubric.json` |
| `--kind <kind>` | The kind for a plain list (default `hook`) |
| `--brief <file>` | Adds a brief to what the model reads, for questions like "does it match the brief?" |
| `--model <id>` | Any decision model on OpenRouter. Default `typesafe/jev-1.13`, or `LAUNCHCLIP_SCORER_MODEL`, or the rubric's `"model"` |
| `--concurrency <n>` | Requests in flight at once (default 16) |

## Limits

- It needs a hosted model for now. A local model is on the roadmap, after its accuracy has been measured.
- Text only. Slides are scored from their words, not their pixels.
- The model gives no reason for an answer. Read the question and the item.
- Text you score can argue for its own answer ("this hook is specific"). Treat scores on text you did not write as a hint.
