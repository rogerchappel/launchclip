# Find formats to borrow from another industry

A post has a **format** (how it is built: its opening, its structure, who speaks) and a **topic** (what it is about). The topic belongs to its industry. The format can move.

`launchclip score library compare` takes two [post libraries](scoring-library.md) from different niches and lists the formats that go with above-normal results in the first and are rare in the second. Those are things to test in the second niche. It is stage 10 of the [scoring roadmap](../SCORING_ROADMAP.md).

## Read this first

- **A hit in one industry is not evidence for another.** The list says "this is common among posts that did well over there, and almost nobody here does it". Whether it works here is unknown until you post it and count.
- **The counts are small.** A format needs only 8 posts in the first library to be listed. A handful of posts from one account can carry a whole entry, so open the example links.
- **Formats are read from words only.** The caption and the transcript are sent, never the video. A post with no transcript is judged on its caption, which says little about how the video is built.

## 1. Collect a library for each niche

Build each one as the [library guide](scoring-library.md) describes, with ordinary and weak posts as well as hits. Keep them in separate files:

```text
out/cooking/library.jsonl
out/cycling/library.jsonl
```

A file called `library.jsonl` is named for its folder (`cooking`). Any other file is named for itself.

## 2. Compare them

```bash
launchclip score library compare out/cooking/library.jsonl out/cycling/library.jsonl
```

The order matters: this lists formats from cooking to test in cycling. Swap the files for the other direction.

```text
Compared cooking (412 posts, 398 with format tags) with cycling (377 posts, 370 with format tags). Tagging cost $0.031.

## Worth testing here

Formats that go with above-normal results in cooking and are rare in cycling.

- **fmt_structure: before_after**. A starting state set against an end state: a change, a transformation or a comparison of two things. In cooking: 31 posts (8%), with a median of 1.9x their own account's normal, 1.7 times the median for that library. In cycling: 4 posts (1%). Examples: [@panfirst at 6.2x](https://...), [@panfirst at 3.1x](https://...), [@slowsunday at 2.8x](https://...).

None of these has been tested in cycling. Doing well in one industry is no evidence for another: try each one and let your own results decide.
```

Add `--json` for the same result as data, `--model <id>` to change the model and `--rubric <file>` to use your own format questions.

### What it does

1. **Tags both libraries with one shared rubric**, [`scoring-format-rubric.json`](scoring-format-rubric.json): six pick-one questions about the opening, the structure, who speaks, the call to action, what the caption does and the tone. Every question has an `other_unclear` option. The tags are named `fmt_...` and sit beside any tags the library already has.
2. **Writes the tags back** to each library file. A row that already has every format tag is not sent again, so a second run costs nothing and a run that stopped can be started again. A row with no caption and no transcript is skipped.
3. **Lists a format** when all of these hold:
   - at least 8 posts in the first library use it and have a settled result;
   - the median result of those posts is 1.25 times the median of the whole first library or more (the **lift**). A result is a post's views against its own account's normal, the [outlier](scoring-library.md#3-read-the-map);
   - in the second library it is on 5% of posts or fewer, or on under a third of the share it has in the first.
4. **Sorts by lift** and shows up to three example posts for each, highest result first.

Tagging uses the text scorer's default model and needs `OPENROUTER_API_KEY`. A library of a few hundred captions costs a few cents.

## Limits

- Nothing shows that a format which does well in one industry does well in another. Give a borrowed format a few posts and let your own numbers decide.
- The comparison counts. It does not test whether a lift is more than chance, and a format that goes with good results has not been shown to cause them. The topics, accounts and audiences behind those posts differ too.
- Who speaks, and anything else about the picture or sound, is a guess from the words. With captions only, expect many `other_unclear` and `no_speech` answers.
- A model's tags are not checked against a person's. Read twenty rows by hand before trusting a tag.
- One question at a time: it does not look at pairs, such as an opening together with a structure.
- If tagging fails part way through a library (no credit, no network), that library's file is left as it was and the answers already paid for in that run are lost.
