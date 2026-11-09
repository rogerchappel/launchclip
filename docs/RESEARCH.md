# Research: evidence and asset gathering

`launchclip research <topic|script.md> --out research/` takes a topic or a
script and finds the evidence behind it, then the assets to show it with. It
is fully automatic and makes no model calls, so the metered `make` pipeline
(`--research auto|on`) and the subscription-agent skill path
(`skills-src/references/research.md`) run the same code. It is strict about
honesty: a claim is verified only when a fetched source states it in one
passage, and every other claim is flagged for the script.

```text
script.md / topic
  └─ claims        src/research/claims.js    checkable sentences: numbers, dates, quotes, entities
  └─ sources       src/research/sources.js   HF, GitHub, arXiv APIs, script links, optional web search
  └─ news          src/research/news.js      keyless leads: company feeds, Hacker News, GDELT, Wikipedia current events
  └─ verify        src/research/verify.js    ledger: verified / contradicted / unverified + quote span
  └─ captures      src/research/capture.js   launchclip.capture.v1 per on-screen source
  └─ social        src/research/social.js    the entity's own X posts: x-embed capture + social-post card
  └─ data          src/research/data.js      tables → cited chart data
  └─ media         src/research/media.js     licence-clear footage and stills (gap map C4)
  └─ people        src/research/people.js    Wikidata role and affiliation, Commons portrait or none
  → research/{evidence.json, captures/, data/, assets.json, social.json, news.json, snapshots/, RESEARCH.md}
```

## Claims

Each sentence with something checkable becomes a claim: numbers with value
and unit (`284B parameters` → 2.84e11, `parameter`; `87.5%` → 87.5,
`percent`), dates, a quoted span, and named entities (repo ids, Hugging Face
ids, arXiv ids, URLs, models, benchmarks, people, organisations). Version
numbers (`GPT-5.5`), ids and the digits of a date are not quantities.
Questions and calls to action are left out. Plain statements with no anchor
("the weights are open") need a model or an agent: `--claims claims.json`
(`{"claims": [{"text", "search"}]}`, sentences copied verbatim) or, inside
`make`, the make model's claim pass merges them in by text.

## Sources

Primary sources come first and are called directly:

| Source | Call | What becomes text |
| --- | --- | --- |
| Hugging Face | `/api/models?search=`, `/api/models/<id>`, `<id>/raw/main/README.md` | the model card plus one line of API facts (created date, licence, safetensors parameter count, downloads) |
| GitHub | `/search/repositories`, `/repos/<o>/<r>`, raw README, releases, `/pulls/<n>`, `/commits/<sha>` | README plus API facts; release notes; PR title, body and merge state; commit message and files |
| arXiv | `export.arxiv.org/api/query` (id or title search) | title, abstract, authors, date |
| Links in the script, `--url` | fetched as pages | readable text, title, site name, publish date |
| Keyless news | company feeds, Hacker News, GDELT, Wikipedia current events (below) | each lead's page, fetched and classified |
| Web search (optional) | Brave (`BRAVE_API_KEY`), Tavily (`TAVILY_API_KEY`) or Serper (`SERPER_API_KEY`) | classified per page (below); a search that finds no primary source is asked again for the company's own page |

Every source gets a `source_class`. **primary**: the party's own words: a
page on the domain of an entity the claims name (`nimbus.ai` or
`news.nimbusai.com` for "Nimbus AI", not `openrouter.ai` for "OpenAI"), its
official account (`x.com/nimbusai`), the paper, the code host, or an outlet's
first-hand report (a statement given to it, an interview, a filing).
**aggregator**: a roundup, digest or monthly-releases page (by its URL, host or
title), or a third-party page that covers three or more of the named
companies. **secondary**: anything else. The rule is structural; there is no
domain allowlist. When a web search returns no primary source, research
searches again for "<company> <product> announcement", restricted with
`site:` to the company's domain once a page on it is known.

### News without a key

With no web search key, current stories still come from four public
sources that need no key or sign-up (`src/research/news.js`; `--news none`
skips them). Each gives leads only: a URL, a title and a date. The page a
lead points at is then fetched, hashed and classified like any other source.

| Source | Asked | Its terms |
| --- | --- | --- |
| Company and publisher feeds | The RSS or Atom feed a named company's official site advertises (`<link rel="alternate">`; the site comes from Wikidata), and any `--feed <url>` | Feeds the site itself offers; `robots.txt` is honoured |
| Hacker News | The HN Search API for what the brief names (stories with a link and more than 20 points), or the official API's front page when the brief names nothing | No key. The official API states no rate limit; a run asks the search twice at most |
| GDELT | The DOC 2.0 article list, once a run | Open for any use with a citation to the [GDELT Project](https://www.gdeltproject.org/); it asks for one request every 5 seconds, which the client enforces |
| Wikipedia | `Portal:Current_events`, only for a brief that asks for the latest; the source links of matching items are followed | A user agent that names the client; requests in series. Its text is never quoted |

Google News RSS is not used: no official statement permits an application
to read it. The client sends `launchclip-research/1` with the project's URL as its
user agent and no personal contact. Before a page or feed on someone's site
is fetched, the site's `robots.txt` is read (once per host) and obeyed: a
closed page is not read, so it verifies and shows nothing. API calls are
not crawling and skip that check.

The rule that a story needs a primary source still holds, and a news index
is never one:

- A lead's page is classified against the names in the brief plus the names
  in its own headline, so a company's post on its own domain is primary
  ("Nimbus Unveils…" on `nimbus.ai`) and a report about it is not.
- A report that is not primary has its links followed once, to pages on the
  domain of the company the story names. That is usually where the primary
  source is.
- Hacker News, GDELT and Wikipedia are how a story was found, never who said
  it. They are listed in `research/news.json` and never reach the script
  notes, the narration or the screen.

For a topic, or a brief that asks for the latest, each kept story's own
headline becomes a claim (`headline: true`, `origin: "news"`) when the page
states it word for word, so it is verified against its page and gets a
capture request like any other claim.

`research/news.json` (`launchclip.research-news.v1`) lists every lead that
was followed: `{queries, freshness, providers: [{id, name, terms, leads}],
stories: [{title, url, publisher, published_at, age_days, via, source_class,
primary, status, reason?, from?, claim}]}`. `status` is `kept`,
`no-primary-source`, `stale`, `undated` (a window is set and the page
gives no date), `off-topic` (the page does not mention what the brief asks
about) or `not-fetched` (with the `reason`: closed by
`robots.txt`, refused by the site, or a failed request). A refusal is a
finding: research never works round a block.

### Publish dates and old news

Every claim with a supporting source carries `published_at`, the date its
best primary source was published (the page's own date; a feed's or index's
date only when the page gives none). A brief that asks for the latest sets a
freshness window from its own words, or from `--fresh-days <n>` (`none`
turns it off):

| The brief says | Window |
| --- | --- |
| "today", "breaking", "yesterday", "this morning" | 3 days |
| "this week", "last week", "just announced" | 10 days |
| "latest", "recent", "news", "headlines", "what's new" | 14 days |
| "this month", "last month" | 45 days |

Inside a window, a lead older than it is not followed, a story whose page
is older is recorded as `stale` and makes no claim, and a claim from the
brief whose source is older stays `verified` but gets `stale: {published_at,
age_days, window_days}` and a `date-or-drop` flag. A verified claim whose
source has no date gets `undated: true` and the same flag. The script notes
list these under "Old news", apart from the facts the writer may present as
new. The ledger records the window as `freshness: {days, asked_by}` and
counts `stale` and `undated` in its summary.

A Hugging Face search keeps the named organisation's upload over re-uploads,
quantisations and fine-tunes; with no org match, a repo needs 25 likes to
count. `GITHUB_TOKEN` and `HF_TOKEN` raise rate limits. Every page checked is
written to `research/snapshots/<sha256>.txt`, where the hash covers the raw
response body. Remote text is data and is never followed as an instruction.

## The ledger: `research/evidence.json`

```jsonc
{
  "schema": "launchclip.evidence.v1",
  "created_at": "ISO",
  "input": { "kind": "script", "file": "script.md" },
  "summary": { "claims": 8, "verified": 5, "contradicted": 2, "unverified": 1, "sources_checked": 4, "primary_sources": 4, "web_search": null },
  "policy": { … },
  "entities": [{ "name", "kind", "claims": ["c001"] }],
  "claims": [{
    "id": "c004", "text": "…", "kind": "number|date|quote|entity|statement", "section": "What changed",
    "values": [{ "raw": "77.0", "value": 77, "unit": null }], "dates": [], "quote": null, "entities": [],
    "status": "verified|contradicted|unverified", "confidence": 0.84, "primary_support": true,
    "published_at": "ISO",                          // the supporting primary source's publish date, when it gives one
    "sources": [{
      "url", "title", "publisher", "published_at", "fetched_at", "sha256", "kind", "primary": true, "finder",
      "supports": true, "confidence": 0.84,
      "quote": { "text": "| DeepSWE v1.1 | 77.0 | … |", "start": 1234, "end": 1290, "row": { "label": "DeepSWE v1.1", "cell": "77.0", "column": "DS-V4.1-Flash-1017" } },
      "conflict": { "claimed", "found" }            // only on a contradicting source
    }],
    "flag": { "action": "fix|cut|soften-or-cite|drop", "message": "…" },   // every claim that is not verified
    "capture": "hf-…",                              // the capture request showing it, if any
    "tables": ["hf-…-benchmark-1"],                 // the data files holding its table, if any
    "data": { "series": [], "panels": [], "source": "…" }   // module-ready data (Evidence data below), verified claims only
  }],
  "excerpts": [{ "text", "url", "publisher" }]     // what primary sources state, for a script pass
}
```

The ledger shares its version string with `production/evidence.json` (the
evidence stage's item list) but not its shape: the ledger keys its version
as `schema` and lives under `research/`.

The rules, all enforced by `validateLedger`:

- **verified**: one passage (a sentence or a table row) of a fetched source
  holds every number, every date and the named entities of the claim, and
  shares enough of its words; a quote must appear verbatim (case and
  punctuation aside). That passage is the quote span. A date may match the
  source's own publish date. A verified claim always has a supporting quote.
- **The passage must name what the claim names**: every benchmark it
  mentions, and every other entity but one when it names three or more
  (one-word fragments such as "Flash" aside). In a table row a model counts
  when a column is headed by it. A release date on a page about the model
  does not verify a launch date on another product.
- **Units must agree**: a multiple or a currency needs the same unit in the
  source ("9x" is not the 9 in "July 9", "$1" is not a bare 1); a percentage
  may match a bare table figure. Versions inside model and benchmark names
  ("Claude Opus 5.5", "Terminal-Bench 4.0") are never quantities.
- **In a table, a number belongs to a model**: the model named right before it
  with "at", "'s", "(" or ":", else the sentence's subject. The number must sit
  in that model's column. "X beats Y with 51.8", where 51.8 is Y's score, is
  **contradicted**, and the flag gives X's real figure.
- **contradicted**: a primary source states a different value for the same
  measure (same unit, most of the claim's words) and no source supports it.
- **unverified, no primary source**: only aggregators or rewrites state it.
  The claim carries `no_primary_source: true` and a `drop` flag: the story
  is dropped, never hedged.
- **unverified**: nothing fetched states it. The flag says to cut a quote, or
  to soften or source anything else. Unverified claims always carry a flag;
  they are never kept silently.

## Capture requests: `research/captures/<id>.json`

One per source that a verified claim puts on screen, at most three claims
each. The source is the best primary supporting source whose quote the page
actually shows (API facts are checked, never captured); an aggregator is never
captured. The schema is the one
`src/evidence/` implements:

```json
{ "schema": "launchclip.capture.v1", "id": "hf-deepseek-v4-1-flash-1017", "url": "https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  "kind": "model-card", "viewport": {"width":1600,"height":1000}, "theme": "dark",
  "beats": [
    {"at":0,"action":"wait","target":null,"dur":0.6,"label":"page settles"},
    {"at":0.6,"action":"scroll","target":{"text":"DeepSWE v1.1"},"dur":1.2,"label":"to DeepSWE v1.1"},
    {"at":1.8,"action":"focus-ring","target":{"text":"DeepSWE v1.1"},"dur":1,"label":"DeepSWE v1.1"},
    {"at":2.8,"action":"highlight","target":{"text":"77.0"},"dur":1.8,"label":"On DeepSWE v1.1 …"},
    {"at":4.6,"action":"pin","target":null,"dur":1.2,"label":"Hugging Face · deepseek-ai"}],
  "out": "assets/evidence/hf-deepseek-v4-1-flash-1017.mp4",
  "provenance": {"source_title":"…","fetched_at":"ISO","publisher":"…","published_at":"ISO"} }
```

Kinds come from the URL: `pr`, `diff`, `commit` and `repo` on GitHub,
`model-card` on Hugging Face, `post` on X, Bluesky, Threads and Mastodon,
`article` for papers and news, else `page`. Highlight targets are cut from
the quote span with markdown removed. A table row gets a focus ring on its
label, then a highlight on the exact cell. A sentence gets the stretch of up
to 14 words around its first number or name, so the page can find it word
for word. A cell value can repeat on a page; the focus ring on the row comes
first, so the capture should highlight the match nearest the ringed row.

## Evidence data: what the builders get

`matchEvidence()` (kit/core/beat-director.mjs) passes `capture.data`, else
`claim.data`, to the evidence builders as `beat.evidence.data`; the
`kit/core/capability-builders-*.mjs` headers are the contract.
`src/research/evidence_data.js` fills it from sources only, for verified
claims and their captures:

| Field | From | Shape |
| --- | --- | --- |
| `capture.data` (pr, commit, diff) | `src/evidence/github.js` over its cached API JSON (`assets/evidence/github-*.json`) | `{module, params}` for repo-pr-card, commit-card or diff-view, the capture's highlight as the token when the patch holds it |
| `capture.data` (post) | the capture's sidecar (`assets/evidence/<id>.evidence.json`) | `{platform, name, handle, text, date?, source: {url, captured_at, screenshot}}` from the page title or the highlighted span |
| `claim.data.series`, `.panels`, `.source` | `research/data/*.json`, the row the claim quotes | `[{label, value}]`, up to six panels `{title, series}` |
| `claim.data.people` | `assets.json` people | `[{name, role?, photo?, photo_credit?, links?}]`, photo only from a licence-clear portrait |
| `claim.data.text`, `.tokens`, `.encoding` | `src/tokenizer.js` (gpt-tokenizer) on a quote claim | the BPE split |
| `claim.data.tex`, `.svg` | TeX in the claim (`$…$`, `\(…\)`) | SVG precomputed when `mathjax-full` is installed |
| `claim.data.sources` | two or more GitHub PR or commit sources | `[{module, params, token}]`, compact `sourceParams`, in date order |

`runResearch` attaches what it can at once. Post data needs the clip's
sidecar, so record the requests with `launchclip research capture research/
[--root .]`, which records each one, says which could not be recorded and
why (EVIDENCE_CAPTURE.md, "When a capture is not made"), and then attaches.
After a single `launchclip evidence capture`, run `launchclip research
attach research/ [--root .]`; either rewrites the ledger and capture
requests with the data. `eval/beat-map-dry-run.mjs`
attaches in memory when it loads a folder.

## Posts on X: `research/social.json` (`launchclip.research-social.v1`)

For each verified claim, research looks for the announcement post the
entity that made the claim put on X. Candidates are the status links and
embeds in the claim's sources (an announcement page usually links or embeds
its post; the raw HTML comes from the fetch memo) and, when a web search
key is set, one x.com-restricted query per claim (`site:x.com/<handle>`
when the entity's handle is known from its own page). Each candidate's
author and text come from the publish.twitter.com oEmbed record
(`fetchXOembed`); when there is none, the `twitter-tweet` embed markup on
the entity's own page stands in, and otherwise the post is left out.

Only official accounts count: the handle must be the entity's name with at
most affix words (`@nimbusai`, `@nimbus_hq`, `@AIatNimbus`), or a handle
given for it in `options.handles`. A fan, tester or reporter is rejected
whatever the post says, and the reason is listed in `rejected`. Research
never signs in and never opens x.com.

```
{schema, created_at, search,
 posts: [{id (status id), url (https://x.com/<handle>/status/<id>), handle, name, text,
          published_at (from the status id), fetched_at, entity, official: {reason},
          found_via ("source:<url>" | "search:<provider>"), confirmed_by ("oembed" | "embed markup"),
          claims: [claim id], capture (capture id),
          card: {module: "social-post", params: {platform, name, handle, text, date, source, highlight?}}}],
 rejected: [{url, handle?, reason}]}
```

Each post also gets a capture request (`kind: "post"`) on the `x-embed`
route, highlighting the claim's figure when the post states it, with the
card's post fields as its `data`. The card renders even when the clip
can't be recorded. Ledger claims list their posts in `posts`.
`options.social: "none"` (runResearch) skips the step.

## Data: `research/data/<id>.json` (`launchclip.research-data.v1`)

Pipe tables in primary sources (markdown, and HTML tables flattened to
pipes) are kept when at least half their cells are numbers and either a
verified claim quotes them or they are benchmark or price tables. Each file
has `source` (url, title, publisher, dates, sha256), `columns`, `rows`
(`{label, values: {column: number|null}, raw: [cells as written], notes}`),
the source's footnotes, the claims it backs, and `views`: ready props for
`bar-chart` (one per measure, the script's subject highlighted) or
`comparison-table` (a two-column spec table). Data modules rebuild the
chart in house style with the source in the frame's source note
(`story.frame.sources`) rather than showing a screenshot of someone else's
chart.

## Assets: `research/assets.json` (`launchclip.research-assets.v1`)

Footage and stills for metaphor beats (`--media "<query>"`, else words from
the script's claim-free sentences), and portraits:

| Provider | Taken when |
| --- | --- |
| Wikimedia Commons | `extmetadata` licence is CC0, public domain, CC BY or CC BY-SA |
| NASA Image and Video Library | NASA-credited (third-party credits are dropped) |
| Internet Archive | the item's `licenseurl` is public domain, CC0 or CC BY (Prelinger items carry it) |
| Library of Congress | rights text says "No known restrictions on publication" |
| Pexels, Pixabay | `PEXELS_API_KEY` / `PIXABAY_API_KEY` set |

NC, ND, fair-use and unlabelled items are dropped at search time and counted
in `rejected`. YouTube, streaming services and social video hosts are blocked
(`BLOCKED_MEDIA_HOSTS`). Each asset has `licence {id, name, url}`, `author`,
`attribution` (a credit line ready to paste), `source_url`, `media_url`,
`query` and `beat`. Icons, music and SFX are resolved by the media-use
skill, not here.

Besides the metaphor queries, research looks for what each verified claim
is about (the organisation, place or event it names; up to three queries).
Those items carry `claims: [id]`, so a planner knows which claim a photo
can sit beside.

**Staging and placing.** `assets.json` holds links. `launchclip research
capture` (and `make`, when it researches) downloads each item into
`assets/research/<id>.<ext>` (`src/research/stage_media.js`): a sized
preview for a Commons image, the medium rendition from NASA's file list,
the smallest full MP4 of an Internet Archive item, and direct files
elsewhere; at most 8 items, 15 MB an image and 80 MB a video, public hosts
only. Each staged entry gains `local`, `bytes`, `sha256` and
`downloaded_from`; one that cannot be staged gains `not_staged` with the
reason.

The licence is checked again at this step, not trusted from the file:
an entry whose licence is missing or not in the clear list, that has no
author or source page, or that sits on a blocked host is never downloaded.
Only staged, licence-clear entries are offered to the planner. Each
inventory line says what the item shows, the claim it was found for (or
"Illustration only: it is not evidence for any claim"; only a portrait is
said to support a claim), its licence and
credit, and how to place it (`media-window`, `photo-scene`):

```text
assets/research/harbour.jpg — image, archive photo "Northside Harbour at dawn" from Wikimedia Commons, 4000×3000 at source, found for "Port Authority". Found for claim c001 ("The Port Authority reopened Northside Harbour."): place it beside that claim only if it shows what the claim is about; it illustrates, the source page proves. Licence: CC BY-SA 4.0; credit "“Northside Harbour at dawn” by A. Photographer, CC BY-SA 4.0, via Wikimedia Commons" (publish.json carries it). Use as {"module": "media-window", …} or a full-bleed {"module": "photo-scene", …} on the line it illustrates.
```

In `make` the storyboard may reference only paths in its asset manifest,
so nothing unstaged or unclear can be placed. `publish.json` then lists
`credits` (asset, title, author, licence, licence URL, source page and the
attribution line) for every research item the storyboard uses and appends
the attribution lines to the description, lists `sources` (URL, title,
publisher, dates) for every recorded page shown, and warns
(`licence: … remove it`) about any `assets/research/` file placed without a
cleared licence on record.

`logos.json` (`launchclip.research-logos.v1`, `src/research/logos.js`): each
organisation the research names, resolved to its official domain (Wikidata's
official website, or `logoDomains`), then its logo fetched at run time from
its own home page (a header SVG, a `<link rel=icon>` SVG, the
apple-touch-icon, an `og:image` only when it is plainly a logo), else the
Simple Icons CDN by slug. No logo pack ships with LaunchClip. Public hosts
only (the evidence capture guard), no credentials, an 8 s timeout and a
512 KB cap per file. Files land in `research/logos/<slug>.svg|png`; each
entry is `{name, domain, file, source_url, kind: "site"|"simple-icons",
colors?}` plus `asset` (the `assets/logos/` path to stage it at, since kit
modules read assets/ paths only; `stageLogos` copies them), `via`,
`monochrome`, `path` (a single-path SVG's `{d, viewBox}`) and `params` ready
for `logo-row`, `brand-lockup`, `orbit-cards` and, with a `path`,
`particle-logo`. `runResearch` returns the entries as `logos` and the files
as `files.logos` / `files.logo_files`. Set `LAUNCHCLIP_LOGO_CACHE` (or the
`logoCache` option) to a directory to cache by domain; `logos: "none"` skips
the step.

`people`: each person the script names, matched on Wikidata only when the
item is a human who is either tied to an organisation the script names or
the only person with that name. The entry gives role, affiliation, Wikidata
id, the role the script gives them, and a Commons portrait (the item's
`P18`) only when its licence is clear; otherwise `portrait: null` with the
reason. A photo is never scraped from a page.

## In `make`

`launchclip make "<prompt>"` researches the brief in the motion lane when
`--research` says so. The default is `auto` (`src/research/auto.js`), which
reads the brief (prompt plus notes) and needs no model or network:

| The brief has | Research |
| --- | --- |
| News wording: "news", "breaking", "headlines", "this week", "yesterday", "just announced", "what happened", "fact-check" | on, even in a brief for a promo |
| A dated event (a day or a month, not a bare year), a named release with a release verb ("Nimbus AI released Nimbus-7B"), a versioned name on its own ("GPT-5.5 explained"), "latest" or "recently", or a question of fact about something named | on, unless it is a product video |
| A product video: launch video, promo, ad, demo, tutorial, walkthrough, testimonial | off: the facts are the brand's own |
| Its own script (a `## Script` or `## Narration` section), or a recording or voiceover (the footage-led and voiceover lanes) | off |
| None of the above (an evergreen topic) | off |

`--research on` always researches and `--research off` never does. Outside
the motion lane nothing new is researched, but capture requests already in
the project's `research/captures/` (from `launchclip research`) are recorded
with `on`, and with `auto` when that folder exists. `MAKE.json` records the
decision as `research_decision: {mode, run, reason, signals}`, and the run
prints it (`research: on (auto): the brief reads as news (news wording:
"this week")`).

When research runs, the brief (prompt plus notes) is written to `research/brief.md` and
researched, and the result is reused while the brief hashes the same. The
script pass gets `researchNotes()`: verified claims, facts from primary
sources, what not to state, the stories to drop, and the source rules: never
name an aggregator or "a report" in the narration or on screen, and state each
fact as the company's. Flagged brief claims become warnings. After
the script, `auditScript()` checks the narration: each claim must match a
verified ledger claim or a primary-source excerpt. Otherwise it is a warning,
and the `research` gate stays `pending`, so the video is ready for review
rather than ready. The gate also goes to `pending` when a verified claim's
source page could not be recorded (no recorder, a paywall, a bot check):
`MAKE.json` `captures` names each claim, the reason and the fix.

## Fixture

`test/fixtures/research/deepseek-v4-1-flash/` is a dry run on a real
release, DeepSeek-V4.1-Flash-1017 (Hugging Face, 17 October 2026), recorded with no keys. Its
script plants three mistakes: one is contradicted by the card's own table,
one by the base model card, and one is unverified. All three are flagged,
and the other five claims verify. `recording.json` holds every HTTP response,
so `test/research_fixture.test.js` replays the run offline byte for byte.
Re-record it with `node scripts/research-fixture.mjs deepseek-v4-1-flash --media "server room" --media "stack of papers"`.
