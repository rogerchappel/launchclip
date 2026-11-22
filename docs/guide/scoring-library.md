# Build a library of real posts from your niche

A post library is a set of real short videos and carousels from your niche, each tagged by a decision model (hook type, format, angle and so on) and joined to its public numbers. From it LaunchClip draws a **niche map**: which kinds of post are crowded, which are open, and which beat their channel's norm. It is stage 3 of the [scoring roadmap](../SCORING_ROADMAP.md) and builds on [`launchclip score`](scoring.md).

There is no command for it yet. The steps below call `runLibrary` from `src/scoring/library.js`.

## Read this first

- **Fetching other people's posts is your responsibility.** Each platform has terms on collecting its content, and so does any scraping service. LaunchClip reads the files or links you give it and takes no view on whether you may hold them.
- **Include ordinary and weak posts, not only the hits.** Take every post from each channel over a period, or a random sample. A library of hits can't show what made them hits, because the misses used the same hooks. The map warns when fewer than a third of posts are below their channel's norm.
- **Public numbers are a rough signal.** Views depend on follower count, posting time, luck and paid promotion as well as the post. Read the map as a list of things worth testing, not as proof.
- Captions are other people's text and can argue for their own tags. Nothing in the library acts on an answer.

## 1. Collect the posts

Bring a file, or fetch with your own Apify account.

```js
import { runLibrary } from "launchclip/src/scoring/library.js";

// A CSV, a JSON array or a JSONL file → library.jsonl
await runLibrary("import", "posts.csv", { platform: "tiktok" });

// Or run an Apify actor (APIFY_TOKEN in your environment; input.json is the actor's own input)
await runLibrary("fetch", "clockworks/tiktok-scraper", { input: "input.json" });
```

Both add to `library.jsonl` if it is already there. A post with the same platform and id is replaced.

A row is one JSON object a line:

```json
{"id": "7301", "platform": "tiktok", "account": "buildfast", "url": "https://...", "posted_at": "2026-03-01T09:00:00.000Z", "caption": "3 fixes for slow builds", "text": "words on screen or spoken, if you have them", "media": "videos/7301.mp4", "followers": 12000, "paid": false, "metrics": {"views": 55000, "likes": 900, "comments": 31, "shares": 40, "saves": 120}}
```

Only `id`, `platform`, `account` and `metrics` are always there. The column names of Apify's TikTok and Instagram scrapers are recognised (`playCount`, `diggCount`, `videoPlayCount`, `likesCount`, `authorMeta.fans`, `ownerUsername`, `createTimeISO`, `timestamp`, `webVideoUrl`, `videoUrl`, `isAd` and so on), and anything else is kept under `raw`. Two things to know:

- A `text` column with no `caption` column is read as the caption, because TikTok's scraper names it that. Put spoken or on-screen words in `transcript`.
- Instagram's post scraper gives no follower count. Add a `followers` column if you want small accounts measured.

An Apify run through this call must finish within 300 seconds, so fetch in batches.

## 2. Tag them

```js
await runLibrary("tag", "library.jsonl", { rubric: "docs/guide/scoring-library-rubric.json" });
```

This writes `library.tagged.jsonl`: each row plus `tags`, `answers` and `outlier`. You need `OPENROUTER_API_KEY`.

- The rubric is a list of closed questions in the [same form as a scoring rubric](scoring.md#write-a-rubric). Start from [`scoring-library-rubric.json`](scoring-library-rubric.json) and add your own. Every answer is recorded as a tag and nothing is failed. A yes/no question is recorded as the probability of yes.
- The default model is `google/gemini-decision-1`, which watches video. Pass `model` to change it.
- `media` is a public `https://` link or a local file. A local video up to 12 MB, or image up to 4 MB, is sent inline. Anything the model can't be sent (a larger file, a link that has expired or blocks the model, a model that takes no video) is tagged from the caption and text alone and marked `media_skipped: true`. Links from scrapers expire within hours, so tag soon after fetching or keep local files you are allowed to hold.
- A 20-second video costs well under a tenth of a cent. Tagging starts again from the first row each time it is run.

## 3. Read the map

```js
await runLibrary("map", "library.tagged.jsonl", { out: "map.json" });
```

```text
Niche map: 412 post(s), 380 with a settled result.

hook_type
  number_or_list                38% of posts (157), median 0.9x its channel, 11% at 2x or more
  contrarian                     6% of posts (25), median 1.6x its channel, 28% at 2x or more
...
Crowded (30% of posts or more): hook_type=number_or_list
Open (10% or fewer; a value no post used is not listed): hook_type=contrarian
Beats its channel's norm (median 1.25x or more over 3+ posts): hook_type=contrarian (1.6x)
```

- **Outlier** is a post's views divided by the median views of the same account's posts in the library, so a small channel's hit counts as a hit. 1 is normal for that channel and 2 is twice normal.
- An account with fewer than 5 posts is measured by views per follower against the whole library's median, or not at all when followers are unknown.
- Posts under 3 days old and paid posts get no outlier and are left out of the medians. Their tags still count toward what is crowded.
- A number is grouped by its nearest whole: a yes/no tag shows as `1` (yes) or `0` (no), a score as its level.
- When the rows have a `hook_type` tag, the map also holds every other tag paired with it.
- The map carries a `caution` when fewer than 100 posts have an outlier, or when it looks like a hits-only library.

## Limits

- A post tagged from its words alone still gets an answer to the questions about its picture (first frame, pacing, face on camera), and that answer is a guess. The map counts it like any other. Check how many rows carry `media_skipped` before reading those tags.
- A model's tags are not checked against a person's. Read twenty rows by hand before trusting a tag.
- Video is sampled into frames, so one-frame text and very fast cuts can be missed.
- The map counts and compares. It does not test whether a difference is more than chance, and a tag that goes with good results has not been shown to cause them.
