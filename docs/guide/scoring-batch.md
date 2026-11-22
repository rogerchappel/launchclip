# A day's carousels from one topic

`launchclip score batch` runs the [hook funnel](scoring-funnel.md) on a topic, turns the first few hooks on the shortlist into carousel plans, and holds every plan's slides to your rubric. It is stage 7 of the [scoring roadmap](../SCORING_ROADMAP.md).

```bash
launchclip score batch "getting more signups from a SaaS launch video" --carousels 5 --rubric rubric.json --out today
```

```text
75 hooks on "getting more signups from a SaaS launch video": 27 passed, 7 shortlisted (today/funnel/shortlist.txt)
01-number  "5 color palette choices that founders should consider to enhance SaaS launch videos"
    ERROR  the carousel could not be planned; the repaired plan still fails:
02-mistake  "Most founders waste 80 percent of their launch video by ignoring viewer attention spans"
    failed: slide-1 failed, slide-6 failed, slide-3 to review
1 of 2 carousel plan(s) written in today; render one with launchclip carousel render <project>. Cost $0.005175.
```

## What it does

1. **Hooks.** Everything `launchclip score hooks` does, into `<out>/funnel`. Every flag of the funnel works here.
2. **Picks.** The shortlist is taken one hook type at a time (each type's first pick, then each type's second), so a small batch is still a spread.
3. **Plans.** Each pick becomes a carousel plan, with the hook as its cover line, in `<out>/01-<type>`, `<out>/02-<type>` and so on.
4. **Gate.** Each plan's cover and slides are scored against the rubric. The answers are in the plan's `score.json`, and the day is summarised in `<out>/batch.json`.

A plan that can't be made is reported and the rest carry on.

## Options

| Option | What it does |
|---|---|
| `--carousels <n>` | How many plans to make (default 5) |
| `--model <provider:model>` | The model that writes the hooks |
| `--make-model <model>` | The model that plans the carousels. Default: the one `launchclip carousel make` uses |
| `--dest`, `--style`, `--slides` | Passed to `launchclip carousel make` |
| `--render` | Also render, check and export each carousel. This is heavy; without it you get plans, and render the ones you like with `launchclip carousel render <project>` |
| `--results <own.tagged.jsonl>` | Your own tagged results: hook types that work for you get more slots |
| `--fit <model.json>` | A [fitted model](scoring-fit.md) that is usable orders the shortlist |

## Limits

- It plans and checks. It does not post or schedule.
- A plan can change the hook's wording on the cover, and the gate then scores what the cover says, not what the hook said.
- A failed slide is reported, not rewritten. Edit the plan, or run it again.
- The hooks are only as true as the writer. A rule that asks for a number invites invented figures: check every figure before you post.
