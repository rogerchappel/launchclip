# Build a library from keywords

You give the keywords for your niche and get a [post library](scoring-library.md) of real posts, without browsing any app yourself.

```bash
launchclip score library discover "sourdough, home baking" --platform tiktok
```

## What you need

- An [Apify](https://apify.com) account, with its API token in your environment as `APIFY_TOKEN`.
- **Apify charges for actor runs**, on your account. What a run costs depends on the actor and on how many posts you ask for, so read the pricing on each actor's page before a large run:
  - TikTok, search and posts: [clockworks/tiktok-scraper](https://apify.com/clockworks/tiktok-scraper). Its date filter (`--days`) is listed as a charged filter; `--days 0` leaves it off.
  - Instagram, search: [apify/instagram-hashtag-scraper](https://apify.com/apify/instagram-hashtag-scraper)
  - Instagram, posts: [apify/instagram-post-scraper](https://apify.com/apify/instagram-post-scraper)
- **Collecting other people's posts is your responsibility.** Each platform has terms on collecting its content, and so does Apify. LaunchClip runs the actors you ask for and takes no view on whether you may hold what they return.

## What it does

1. Runs a keyword search once and reads who is behind the results.
2. Picks the creators with the most results (then the best views).
3. Collects each creator's recent posts, a few creators a run, one run after another. Each run has to finish inside Apify's 300 seconds. A run that fails is reported as a warning and the rest carry on.

## Why it collects ordinary posts too

A search returns hits. A library of hits can't show what made them hits, because the same creators' misses used the same hooks. So the search is used only to find creators, and the library is filled with everything they posted in the period, weak posts included. Pinned posts are left out, since a creator pins their best.

The summary gives `below_norm_share`: of the posts with a settled result, the share that did worse than normal for their own account. Under a third, it warns that the library looks hits-only. Raise `--per-creator` or `--days` and run it again.

## What it writes

- `library.jsonl`: the creators' posts, one a line. If the file is there already the posts are added to it, and a post with the same platform and id is replaced, as with `library import`.
- `creators.json`, beside it: the keywords, and each creator picked with their number of search results, best views and followers when known.

Then carry on with [`library tag` and `library map`](scoring-library.md).

## Options

| Flag | Default | |
| --- | --- | --- |
| `--platform` | `tiktok` | `tiktok` or `instagram` |
| `--creators` | 15 | how many creators to collect |
| `--per-creator` | 30 | posts a creator, newest first |
| `--days` | 90 | how far back to go; 0 for no limit |
| `--search-limit` | 100 | search results in all, shared between the keywords |
| `--search-actor`, `--posts-actor` | see above | another Apify actor that takes the same input |
| `--out` | `library.jsonl` | the library to add to |

Instagram's post scraper gives no follower count, so on Instagram an account with fewer than 5 posts in the library gets no outlier figure.

## Another discovery service

Nothing here depends on Apify beyond this one command. Export the posts from any service as CSV, JSON or JSONL and run:

```bash
launchclip score library import posts.csv --platform tiktok
```

Take each creator's whole recent feed, not a list of top posts, for the reason above.
