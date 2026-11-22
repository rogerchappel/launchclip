# Draft a rubric from your niche's real posts

A [rubric](scoring.md#write-a-rubric) is a list of closed questions. Writing one by hand means guessing which questions matter. This command drafts one from a [library of real posts](scoring-library.md): it looks for yes/no questions whose answers differ between posts that beat their channel's norm and posts that did not.

```bash
launchclip score rubric draft library.jsonl --niche "home baking"
```

It writes `rubric.draft.json` and prints a table. The draft is a starting point for you to review, not a finished rubric.

You need `OPENROUTER_API_KEY`, and a writing model in `LAUNCHCLIP_MAKE_MODEL` or `--model` (for example `--model openrouter:openai/gpt-4.1-mini`).

## The parts of a post

The drafter works on one part of a post at a time. A part is used when the library's rows have it.

| Part | Read from the row's | Questions come from | `on` in the draft |
| --- | --- | --- | --- |
| `written_hook` | `caption` | the writing model | `hook` |
| `spoken_hook` | `spoken_hook`, the first sentence said | the writing model | `hook` |
| `script` | `transcript` | the writing model | `script` |
| `thumbnail` | `thumb`, a stored cover image, else `media`, the cover's link | a [starter file](scoring-thumbnail-questions.json) | `cover` |

The writing model cannot see images. So the cover's questions are a fixed starter list that fits any industry: a face is shown, text is overlaid, the text can be read on a phone, there is one clear subject, and so on. They are tested like any other question.

A row may also carry `facts`: numbers and yes/no values that need no model. See [Facts](#facts).

## What it does

1. **Measures each post against its own channel.** A post's outlier is its views divided by that channel's median, as in the [library guide](scoring-library.md#3-read-the-map).
2. **Picks contrast sets, for each text part.** For up to 8 channels it takes the channel's top posts (those at 2 times its norm or more, else its top quarter) and some of its posts at or below its median. Only posts that have the part are used.
3. **Asks a writing model for questions about that part.** The model sees one channel's two groups, with that part's text only, and proposes yes/no questions about how it is written or made. It is told not to ask about the topic, the creator or the numbers, and not to ask whether a post is good. `--questions` is shared between the parts.
4. **Asks every question of the other posts.** The posts shown to the writer for a part are set aside for that part. A decision model answers each part's questions from that part alone: a script question sees only the transcript, a cover question only the image. A post with no transcript answers no script question.
5. **Judges each question.** It checks whether the answer goes with results on those posts, and gives the question a verdict.
6. **Tests the facts.** No model is asked.
7. **Writes the draft**, and says whether it is [ready to use](#when-a-draft-is-ready).

## Read the table

```text
Rubric draft from 412 post(s): 380 with a settled result, 76 shown to the writer (8 channel(s)), 304 judging the questions.

verdict   question                    rho  95% range         yes: hits / rest      n  winners do it  part
keep      opens_with_number        +0.314  +0.205 to +0.418  61% / 34%           304  more           written_hook
keep      cover_shows_face         -0.287  -0.392 to -0.179  9% / 27%            380  less           thumbnail
unproven  ends_with_question       +0.061  -0.052 to +0.171  22% / 18%           120  -              script
fact      duration_s               +0.150  +0.050 to +0.248  - / -               380  more           facts
drop      has_caption              +0.000  +0.000 to +0.000  100% / 100%         304  -              written_hook

30 question(s): 2 kept as gates, 24 unproven (tags), 4 dropped. With 30 tested at once, one is kept only when its range still excludes 0 at the 99.83% level.
Status: 380 post(s) judging, 2 question(s) kept.
Not ready: the kept questions have not been tested on a second library (--second).
```

- **rho** is the rank correlation between how sure the model is that the answer is yes and how far the post beat its channel. 0 is no link. Above 0 means posts that do better do it more.
- **95% range** comes from resampling the posts 1,000 times. A range that includes 0 could be chance.
- **yes: hits / rest** is the share answered yes among posts at 2 times their channel's norm or more, and among the rest.
- **n** is how many posts answered the question.
- **part** is the part of the post the question is about.

The verdicts:

| Verdict | When | In the draft |
| --- | --- | --- |
| `keep` | The range excludes 0 at the stricter level below, on 100 posts or more | A gate. `"want": false` when winners do it less |
| `unproven` | Anything else | A tag: `"gate": false`, recorded and never failed |
| `fact` | A number or yes/no value from the row's `facts` | Under `facts`, never a question |
| `drop` | Nearly every post gets the same answer (95% or more yes, or no) | Left out |

A kept question that winners only sometimes meet (fewer than 75% of them, or more than 25% for "less") is written as a tag too, because as a gate it would fail most winners.

Every question in the draft carries its `part`, its `on` and an `evidence` field with these numbers. The scorer ignores `part` and `evidence`.

### Many questions at once

Test 30 questions at the 95% level and one or two pass by luck. So the bar rises with the number tested: with N questions in a run, a question is kept only when its range still excludes 0 at the level 1 - 0.05 / N (the Bonferroni correction). For 30 questions that is 99.83%. The chance that any question with no real link is kept is then about 1 in 20 for the whole run, not for each question.

The table still shows the 95% range. A question can show a range clear of 0 and still be `unproven`: it passed the ordinary test, not the stricter one. Asking for fewer questions lowers the bar for each.

## Facts

A row's `facts` are tested against results directly:

| Fact | How it is tested |
| --- | --- |
| `has_speech`, `slideshow`, `original_sound` | yes or no |
| `duration_s`, `first_word_s`, `words_per_s`, `cuts_per_s`, `first_cut_s` | as low, middle or high: its third within this library |

A fact is never a gate, because the scorer does not see these numbers when it scores your draft. Facts are written under a separate `facts` key in the draft, each with its numbers. A banded fact also has `edges` (where the thirds meet) and `bands` (each third's size and its share of hits). Use them as guidance: "the top third for length did better" is a note for whoever plans the video.

## When a draft is ready

The last lines of the output are a status. A draft is ready to use when all of these hold:

1. **At least one question is kept.** That needs 100 judging posts or more.
2. **The kept questions hold on a second library.** Pass `--second other.jsonl`, a library from another discovery run with other creators. Each kept question is asked again there. It stays kept only if its direction is the same in both. Otherwise it becomes a tag. Posts from channels that are also in the first library are left out of this test.
3. **Nothing changed since the last draft.** If the `--out` file already exists, the command compares its kept questions with the new ones and reports what was added and removed, then overwrites it. A question counts as the same by its key, or by nearly the same wording. Add posts and run it again until nothing changes.

```text
Status: 380 post(s) judging, 2 question(s) kept, 2 held on the second library.
Since the last draft: no kept question changed.
Ready to use.
```

Otherwise the last line is `Not ready:` and the first condition that is not met. With `--json`, the same is in `status`: `judging_posts`, `kept`, `held_on_second`, `changed_since_last` (`added` and `removed`) and `ready`.

## What to do next

1. **Review every question.** Read its wording and its numbers. Delete what makes no sense for your brand.
2. **Delete repeats.** Two parts can ask the same thing. Be wary of a kept question that few posts answer yes to.
3. **Add your brand rules.** Banned claims and voice are not in any library. Add them yourself.
4. **Check `on`.** Each question is asked of one kind of item: `hook`, `script` or `cover`. A caption question is `on: "hook"`, because a caption does a hook's job. Change it if it does not fit a single spoken line. A `cover` question was learned from images. `launchclip score` reads a cover's text, so a question about the picture needs the image to be scored.
5. **Measure it.** Label a set by hand and run `npm run eval:scorer` ([measuring a scoring model](scoring-measure.md)) before a gate drops anything.

Then use it like any rubric: `launchclip score hooks.txt --rubric rubric.draft.json`.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `--niche "<a few words>"` | none | Tells the writing model what the posts are about |
| `--questions <n>` | 30 | How many questions to test, shared between the parts |
| `--sets <n>` | 8 | How many channels to draw contrast sets from, for each part |
| `--text-only` | off | Skips the thumbnail part |
| `--second <library.jsonl>` | none | A second library to test the kept questions on |
| `--model <provider:model>` | `LAUNCHCLIP_MAKE_MODEL` | The writing model |
| `--scorer-model <id>` | `google/gemini-decision-1` | The decision model that answers the questions |
| `--concurrency <n>` | 8 | Posts answered at once |
| `--seed <n>` | 1 | Changes which channels and ordinary posts are drawn |
| `--out <file>` | `rubric.draft.json` | Where the draft goes. An earlier draft there is compared with, then overwritten |

## Cover images

A stored cover (`thumb`, a path relative to the library file's folder) is sent inline as a base64 data URL. Only a `.jpg`, `.png` or `.webp` file inside that folder, of 4 MB or less, is read. A row with no stored cover is sent its `media` link, which the model must fetch itself and which may have expired.

Models differ in what they take:

- `google/gemini-decision-1` takes an inline image or a link.
- `typesafe/jev-1.13` takes only an inline JPEG or PNG, and refuses a link. It also refused a 1080 by 1920 cover and one under 288 pixels on its short side, and took sizes between (288 by 512 up to 576 by 1024). Store covers about 768 pixels on the long side.

A cover the model refuses judges nothing. The command counts these and warns.

## Limits

- **It needs a few hundred posts with view counts.** Under 100 judging posts nothing is kept, every question is a tag, and the command says so. This applies to each part: 60 posts with a transcript cannot keep a script question.
- **It needs ordinary posts, not only hits.** It warns when fewer than a third of posts are below their channel's norm.
- **A kept question is an association in this library, not a cause.** Changing a draft to gain a yes may not change its result.
- **Posts are other people's text.** They are sent to the writing model as data, and a post can still nudge what it proposes. Read the questions before you use them.
- **The writer never sees the video.** Nothing about the picture is proposed beyond the starter cover questions, and nothing about the edit beyond the facts.
- **Public view counts are a rough signal.** They depend on follower count, timing and luck as well as the post.
