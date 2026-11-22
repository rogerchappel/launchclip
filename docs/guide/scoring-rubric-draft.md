# Draft a rubric from your niche's real posts

A [rubric](scoring.md#write-a-rubric) is a list of closed questions. Writing one by hand means guessing which questions matter. This command drafts one from a [library of real posts](scoring-library.md): it looks for yes/no questions whose answers differ between posts that beat their channel's norm and posts that did not.

```bash
launchclip score rubric draft library.jsonl --niche "home baking"
```

It writes `rubric.draft.json` and prints a table. The draft is a starting point for you to review, not a finished rubric.

You need `OPENROUTER_API_KEY`, and a writing model in `LAUNCHCLIP_MAKE_MODEL` or `--model` (for example `--model openrouter:openai/gpt-4.1-mini`).

## What it does

1. **Measures each post against its own channel.** A post's outlier is its views divided by that channel's median, as in the [library guide](scoring-library.md#3-read-the-map).
2. **Picks contrast sets.** For up to 8 channels it takes the channel's top posts (those at 2 times its norm or more, else its top quarter) and some of its posts at or below its median.
3. **Asks a writing model for questions.** The model sees one channel's two groups and proposes yes/no questions about how a post is written or made: the opening, structure, specificity, format, call to action, tone. It is told not to ask about the topic, the creator or the numbers, and not to ask whether a post is good.
4. **Asks every question of the other posts.** The posts shown to the writer are set aside. A decision model answers each question for every remaining post that has a result.
5. **Judges each question.** It checks whether the answer goes with results on those posts, and gives the question a verdict.
6. **Writes the draft.**

## Read the table

```text
Rubric draft from 412 post(s): 380 with a settled result, 76 shown to the writer (8 channel(s)), 304 judging the questions.

verdict   question                    rho  95% range         yes: hits / rest      n  winners do it
keep      opens_with_number        +0.214  +0.105 to +0.318  61% / 34%           304  more
keep      opens_with_greeting      -0.187  -0.292 to -0.079  9% / 27%            304  less
unproven  ends_with_question       +0.061  -0.052 to +0.171  22% / 18%           304  -
drop      has_caption              +0.000  +0.000 to +0.000  100% / 100%         304  -

30 question(s): 2 kept as gates, 24 unproven (tags), 4 dropped. About 1 in 20 questions with no real link to results is kept by luck.
```

- **rho** is the rank correlation between how sure the model is that the answer is yes and how far the post beat its channel. 0 is no link. Above 0 means posts that do better do it more.
- **95% range** comes from resampling the posts 1,000 times. A range that includes 0 could be chance.
- **yes: hits / rest** is the share answered yes among posts at 2 times their channel's norm or more, and among the rest.
- **n** is how many posts answered the question.

The verdicts:

| Verdict | When | In the draft |
| --- | --- | --- |
| `keep` | The range excludes 0, on 100 posts or more | A gate. `"want": false` when winners do it less |
| `unproven` | Anything else | A tag: `"gate": false`, recorded and never failed |
| `drop` | Nearly every post gets the same answer (95% or more yes, or no) | Left out |

Every question in the draft carries an `evidence` field with these numbers. The scorer ignores it.

## What to do next

1. **Review every question.** Read its wording and its numbers. Delete what makes no sense for your brand.
2. **Delete noise.** With 30 questions tested at once, one or two are kept by luck. Remove questions that say the same thing twice. Be wary of a kept question that few posts answer yes to: as a gate it will fail most of what you write.
3. **Add your brand rules.** Banned claims and voice are not in any library. Add them yourself.
4. **Check `on`.** The questions were learned from whole posts and apply to every kind of item. Before one gates hooks, check it makes sense for a single line, and set `"on"` if it does not.
5. **Measure it.** Label a set by hand and run `npm run eval:scorer` ([measuring a scoring model](scoring-measure.md)) before a gate drops anything.

Then use it like any rubric: `launchclip score hooks.txt --rubric rubric.draft.json`.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `--niche "<a few words>"` | none | Tells the writing model what the posts are about |
| `--questions <n>` | 30 | How many questions to test |
| `--sets <n>` | 8 | How many channels to draw contrast sets from |
| `--model <provider:model>` | `LAUNCHCLIP_MAKE_MODEL` | The writing model |
| `--scorer-model <id>` | `google/gemini-decision-1` | The decision model that answers the questions |
| `--concurrency <n>` | 8 | Posts answered at once |
| `--seed <n>` | 1 | Changes which channels and ordinary posts are drawn |
| `--out <file>` | `rubric.draft.json` | Where the draft goes |

## Limits

- **It needs a few hundred posts with view counts.** Under 100 judging posts nothing is kept, every question is a tag, and the command says so.
- **It needs ordinary posts, not only hits.** It warns when fewer than a third of posts are below their channel's norm.
- **A kept question is an association in this library, not a cause.** Changing a draft to gain a yes may not change its result. A question that is kept again on a second library is the one to trust.
- **Posts are other people's text.** They are sent to the writing model as data, and a post can still nudge what it proposes. Read the questions before you use them.
- **The questions come from captions and words on screen.** The writer never sees the video, so nothing about the picture is proposed.
- **Public view counts are a rough signal.** They depend on follower count, timing and luck as well as the post.
