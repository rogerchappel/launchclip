# A rubric for a niche, in one command

Give `launchclip score niche` a keyword for your industry. It finds the creators, collects their posts, gathers the evidence, drafts a rubric and writes a report you can read.

```bash
launchclip score niche "horse racing" --niche "horse racing for punters and owners"
```

It needs an [Apify](https://apify.com) token (`APIFY_TOKEN`) for the posts, an OpenRouter key (`OPENROUTER_API_KEY`) for the models, and a writing model (`--model`, or `LAUNCHCLIP_MAKE_MODEL`). Apify charges for each post it returns, on your account. Collecting other people's posts is your responsibility under each platform's terms.

## What it does

| Step | What happens | Its own command |
|---|---|---|
| Discover | A search for each keyword finds creators; each creator's recent posts are collected, ordinary ones included | [`score library discover`](scoring-discover.md) |
| Keywords | More keywords are found from the hashtags the creators share and from a writing model, each marked in the niche, neighbouring or off topic | `score library keywords` |
| Evidence | For each post: the caption, the platform's own subtitles as a transcript, the first sentence spoken, a small copy of the cover, and timings. No video is downloaded | `score library evidence` |
| Formats | Each post is tagged with how it is built, using one rubric shared by every niche | [`score library compare`](scoring-compare.md) |
| Draft | Questions are written per part (written hook, spoken hook, script, cover) and each is tested on posts the writer never saw | [`score rubric draft`](scoring-rubric-draft.md) |
| Report | The evidence, as a page you read | |

Run it again and each step skips what is done. Nothing asks a question, so it runs the same on a server.

## The folder

Each niche has its own folder, so one machine can hold many industries or customers.

```text
niches/horse-racing/
  niche.json          the keywords and what was collected for each
  creators.json       who was found, and by which keyword
  library.jsonl       one line a post: words, transcript, facts, results, format tags
  thumbs/             small copies of the covers
  rubric.draft.json   the questions, with their numbers
  report.md           the evidence
```

`--dir`, or `LAUNCHCLIP_NICHES`, sets where niches live (default `niches`, which git ignores). A post is about 1 KB and a cover about 15 KB, so a thousand posts is about 16 MB. `--text-only` keeps no covers.

Then use the niche by name anywhere a rubric is asked for:

```bash
launchclip score hooks "the first race of the season" --rubric horse-racing
```

That reads `rubric.json` in the niche's folder if you have saved a reviewed one there, else the draft.

## More of the industry

The first run lists the keywords it found and collects only yours. To collect the in-niche ones too:

```bash
launchclip score niche --name horse-racing --widen
```

`--keywords <n>` is how many to take (default 5), and each keyword gets its own `--creators` (default 8), so one corner of the industry cannot fill the library. To choose them yourself, edit `niche.json`: a keyword with `"relation": "in"` and no `"done"` is collected on the next `--widen` run.

## Options

| Option | What it does |
|---|---|
| `--name <niche>` | The folder's name. Default: the first keyword |
| `--niche "<words>"` | The niche in a few words, for the models that write |
| `--platform tiktok\|instagram` | Where to look (default tiktok). Instagram gives captions and covers, no transcripts |
| `--creators`, `--per-creator`, `--days`, `--search-limit` | Passed to discovery, per keyword |
| `--widen`, `--keywords <n>` | Collect the in-niche keywords that were found |
| `--text-only` | No covers: nothing is kept and no cover question is asked |
| `--with-video` | Also download a sample of each creator's best and worst videos for cuts and a contact sheet, then delete them ([guide](scoring-video.md)) |
| `--second <library.jsonl>` | A second library with other creators, to test the kept questions on |
| `--questions <n>`, `--model <provider:model>` | Passed to the drafter |

## When the rubric is ready

The report says "Ready to use" when a question was kept, the kept questions held on a `--second` library, and nothing changed since the last draft. Until then it says what is missing. Expect a few hundred to a thousand posts before anything is kept: a question needs 100 posts that have its part, and only posts where someone speaks have a spoken hook or a script.

## Limits

- A kept question is a pattern in this library, not a cause.
- Transcripts are the platform's automatic subtitles. They have errors, and a post with music and no speech has none.
- A cover is one frame. It says nothing about motion, sound or pacing; `--with-video` adds cuts.
- The search decides who is in the library, and it returns broad accounts as well as specialists. Read `creators.json`, and delete a creator's lines from `library.jsonl` if they do not belong.
- Scoring a finished cover's image with `launchclip score` is not built: cover questions in a rubric are answered from the cover's text.
