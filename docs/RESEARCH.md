# Research: evidence and asset gathering

`launchclip research <topic|script.md> --out research/` takes a topic or a
script and finds the evidence behind it, then the assets to show it with. It
is fully automatic and makes no model calls, so the metered `make` pipeline
(`--research on`) and the subscription-agent skill path
(`skills-src/references/research.md`) run the same code. It is strict about
honesty: a claim is verified only when a fetched source states it in one
passage, and every other claim is flagged for the script.

```text
script.md / topic
  └─ claims        src/research/claims.js    checkable sentences: numbers, dates, quotes, entities
  └─ sources       src/research/sources.js   HF, GitHub, arXiv APIs, script links, optional web search
  └─ verify        src/research/verify.js    ledger: verified / contradicted / unverified + quote span
  └─ captures      src/research/capture.js   launchclip.capture.v1 per on-screen source
  └─ data          src/research/data.js      tables → cited chart data
  └─ media         src/research/media.js     licence-clear footage and stills (gap map C4)
  └─ people        src/research/people.js    Wikidata role and affiliation, Commons portrait or none
  → research/{evidence.json, captures/, data/, assets.json, snapshots/, RESEARCH.md}
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
| Web search (optional) | Brave (`BRAVE_API_KEY`), Tavily (`TAVILY_API_KEY`) or Serper (`SERPER_API_KEY`) | secondary unless the host is primary or the org's own domain |

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
    "sources": [{
      "url", "title", "publisher", "published_at", "fetched_at", "sha256", "kind", "primary": true, "finder",
      "supports": true, "confidence": 0.84,
      "quote": { "text": "| DeepSWE v1.1 | 77.0 | … |", "start": 1234, "end": 1290, "row": { "label": "DeepSWE v1.1", "cell": "77.0", "column": "DS-V4.1-Flash-1017" } },
      "conflict": { "claimed", "found" }            // only on a contradicting source
    }],
    "flag": { "action": "fix|cut|soften-or-cite", "message": "…" },   // every claim that is not verified
    "capture": "hf-…",                              // the capture request showing it, if any
    "data": ["hf-…-benchmark-1"]                    // the data files holding its table, if any
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
- **In a table, a number belongs to a model**: the model named right before it
  with "at", "'s", "(" or ":", else the sentence's subject. The number must sit
  in that model's column. "X beats Y with 51.8", where 51.8 is Y's score, is
  **contradicted**, and the flag gives X's real figure.
- **contradicted**: a primary source states a different value for the same
  measure (same unit, most of the claim's words) and no source supports it.
- **unverified**: nothing fetched states it. The flag says to cut a quote, or
  to soften or source anything else. Unverified claims always carry a flag;
  they are never kept silently.

## Capture requests: `research/captures/<id>.json`

One per source that a verified claim puts on screen, at most three claims
each. The source is the best primary supporting source whose quote the page
actually shows (API facts are checked, never captured). The schema is the one
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
`query` and `beat`. Icons, logos, music and SFX are resolved by the media-use
skill, not here.

`people`: each person the script names, matched on Wikidata only when the
item is a human who is either tied to an organisation the script names or
the only person with that name. The entry gives role, affiliation, Wikidata
id, the role the script gives them, and a Commons portrait (the item's
`P18`) only when its licence is clear; otherwise `portrait: null` with the
reason. A photo is never scraped from a page.

## In `make`

`launchclip make "<prompt>" --research on` (motion lane, off by default):
the brief (prompt plus notes) is written to `research/brief.md` and
researched, and the result is reused while the brief hashes the same. The
script pass gets `researchNotes()`: verified claims, facts from primary
sources, and what not to state. Flagged brief claims become warnings. After
the script, `auditScript()` checks the narration: each claim must match a
verified ledger claim or a primary-source excerpt. Otherwise it is a warning,
and the `research` gate stays `pending`, so the video is ready for review
rather than ready.

## Fixture

`test/fixtures/research/deepseek-v4-1-flash/` is a dry run on a real
release, DeepSeek-V4.1-Flash-1017 (Hugging Face, 17 October 2026), recorded with no keys. Its
script plants three mistakes: one is contradicted by the card's own table,
one by the base model card, and one is unverified. All three are flagged,
and the other five claims verify. `recording.json` holds every HTTP response,
so `test/research_fixture.test.js` replays the run offline byte for byte.
Re-record it with `node scripts/research-fixture.mjs deepseek-v4-1-flash --media "server room" --media "stack of papers"`.
