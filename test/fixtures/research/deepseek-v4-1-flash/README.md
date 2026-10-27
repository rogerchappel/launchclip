# Research dry run: DeepSeek-V4.1-Flash-1017

A real open-weights release, published on Hugging Face on 17 October 2026, run through `launchclip research` with no API keys (no web search, no Pexels or Pixabay):

```bash
launchclip research test/fixtures/research/deepseek-v4-1-flash/script.md --out research --media "server room" --media "stack of papers"
```

`script.md` is written the way a script writer would write it, with three deliberate mistakes so the flags can be seen working:

| Claim | Planted mistake | Verdict |
| --- | --- | --- |
| c005 "beats Opus 5 with 51.8" on Terminal-Bench 4.0 | 51.8 is Opus 5's score; DeepSeek's is 42.3 | contradicted, from the model card's own table |
| c007 "trained on 40 trillion tokens" | the base model card says 45T | contradicted, from the base model card |
| c008 Liang Wenfeng "has built the lab around releasing open weights" | nothing fetched says so | unverified, flagged to soften or source |

Everything else verifies against the model card, with the quote span that supports it.

- `research/evidence.json`: the ledger (`launchclip.evidence.v1`).
- `research/captures/*.json`: capture requests (`launchclip.capture.v1`) for `src/evidence/`.
- `research/data/*.json`: the card's benchmark and parameter tables, cited, with bar-chart props.
- `research/assets.json`: licence-clear stills from Wikimedia Commons with attribution strings, plus Liang Wenfeng from Wikidata (no portrait: the item has no image). The Library of Congress answered 403 (a bot check) during the recording, so it contributed nothing.
- `research/snapshots/`: the text of every page that was checked, named by its sha256.
- `recording.json`: every HTTP response, so `test/research_fixture.test.js` replays the run offline and checks the files above byte for byte. Re-record with `node scripts/research-fixture.mjs deepseek-v4-1-flash --media "server room" --media "stack of papers"`.
