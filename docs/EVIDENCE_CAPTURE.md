# Evidence capture

`launchclip evidence capture` records a real public page as evidence: a
GitHub PR or its Files changed diff, a Hugging Face model card, a company
announcement, a news article, a benchmark site. The page plays its beats
behind a dark browser chrome with the URL: a smooth zoom to a region, a
cursor gliding to a target, a text-selection sweep over a phrase, a focus
ring stepping row to row, a date pill pinned on the page. The clip then goes
into a storyboard as an `evidence-clip` scene (KIT_CONTRACTS.md, "Evidence
clip").

Code: `src/evidence/` (request, capture, timeline, player, cli). Tests:
`test/evidence_capture.test.js`, `test/evidence_clip.test.js`.

```bash
launchclip evidence check requests/pr-39217.json
launchclip evidence capture requests/pr-39217.json            # clip, poster, sidecar
launchclip evidence capture requests/pr-39217.json --still --target "text:gpt-6.1-terra" --scale 4
launchclip evidence scene assets/evidence/pr-39217.evidence.json   # evidence-clip params
```

Relative `out` paths resolve from `--root` (default: the current directory,
normally the story project).

## The request (`launchclip.capture.v1`)

```json
{ "schema": "launchclip.capture.v1", "id": "pr-39217", "url": "https://github.com/dotnet/efcore/pull/39217/files",
  "kind": "page|post|repo|pr|diff|commit|model-card|chart|article",
  "viewport": { "width": 1600, "height": 1000 }, "theme": "dark",
  "beats": [{ "at": 0.0, "action": "scroll|zoom|cursor|select|highlight|focus-ring|pin|wait",
              "target": "css selector or {text: 'gpt-6.1-terra'}", "dur": 1.2, "label": "Oct 16, 2026" }],
  "out": "assets/evidence/pr-39217.mp4",
  "provenance": { "source_title": "…", "fetched_at": "ISO", "publisher": "…", "published_at": "ISO?" } }
```

| Field | Rule |
| --- | --- |
| `schema` | exactly `launchclip.capture.v1` |
| `id` | 1–64 letters, digits, `.`, `-`, `_`; names every output file |
| `url` | public http(s); no credentials; local and private hosts are refused |
| `kind` | one of the nine kinds (default `page`); recorded in the sidecar |
| `viewport` | even width and height, 480–3840 (default 1600×1000). The video is this size; the chrome takes the top 52 px per 1000 |
| `theme` | `dark` (default) or `light`: the page's `prefers-color-scheme` |
| `beats` | see below; sorted by `at` |
| `out` | `.mp4` (H.264) or `.webm` (VP9), no `..` (default `assets/evidence/<id>.mp4`) |
| `provenance` | `source_title`, `publisher` and `fetched_at` required; `published_at` optional. Copied into the sidecar |

Additive extensions, all optional:

- **Targets:** a string is a CSS selector. `{text}` finds a phrase in the
  visible text (whitespace collapsed, exact case first, then any case), even
  across `<span>`s. Either form takes `nth` (0-based match), `within` (a
  selector to search inside), and a text target takes `closest` (use the
  ancestor matching a selector, such as `"tr"` for a whole diff row).
  Text inside shadow DOM (GitHub's `<relative-time>` "last week") is not
  searched; target a neighbour or a selector instead. The browser runs in
  UTC, so target dates as the page renders them in UTC.
- `target: null` is the same as no target (wait and pin beats).
- `label` is a note of up to 160 characters on most beats; on a `pin` it is
  the pill's text and stays within 48.
- `beat.zoom`: a fixed scale (1–4) for a zoom beat.
- `chrome`: `dark` (default) or `none`.
- `fps`: 24, 25, 30 (default), 50 or 60. `tail`: seconds held after the last
  beat (default 1.2).
- `wait_for`: a selector that must be visible before capture.
- `hide`: up to 12 selectors of page furniture to hide before capture (a
  promo popover, a chat widget). Recorded in the sidecar. Never use it on the
  evidence itself.
- `still`: `{target?, pad? (CSS px, default 24), scale? (1–4, default 3)}`, the
  default crop for `--still`.

### Beats

| Action | Target | What it does (default `dur`) |
| --- | --- | --- |
| `scroll` | any | brings the target's top a quarter of the way down the window, keeping the zoom (1.2 s) |
| `zoom` | any | frames the target at most 0.62 of the window, 1–2.6× (or `beat.zoom`); zoom on a target that fills the width does nothing useful, so zoom on the phrase (1.2 s) |
| `cursor` | any | a cursor fades in (first time) or glides on a slight arc to the target (0.9 s) |
| `select` | `{text}` | a browser-blue selection sweeps the phrase line by line; a visible cursor drags with it; the next selection clears it (0.9 s) |
| `highlight` | `{text}` | an accent marker sweeps the phrase and stays (0.9 s) |
| `focus-ring` | any | an accent ring grows round the target, then steps to each next target (0.6 s) |
| `pin` | optional | a date pill (`label`, required) pops in beside the target and scrolls with the page, or in the window's lower right without a target (0.5 s) |
| `wait` | none | holds (1 s) |

A targeted beat whose target is not well inside the window first pans to it
(at most 0.6 s), then plays. The camera eases on easeInOutSine, the scale in
log space.

## What the capture does

1. **Opens** the page in a fresh Chromium context (no cookies, no profile,
   no downloads, service workers blocked; the demo recorder's browser setup).
   It never types, and refuses any form POST, so it never signs in.
2. **Consent:** presses the most privacy-preserving choice: a known consent
   platform's reject button (OneTrust, Cookiebot, Didomi, Funding Choices,
   Usercentrics, Quantcast, TrustArc), or a button labelled Reject all /
   Decline / Only necessary / Continue without accepting inside something
   about cookies or consent, in the page or a consent iframe. With no refusal
   on offer it hides the banner (known containers, or a fixed bar about
   cookies or privacy), which consents to nothing. It never presses Accept.
   The sidecar's `consent` says which.
3. **Blocks fail:** an HTTP error, a bot check, a sign-in redirect or wall, a
   paywall phrase ("subscribe to continue reading", "you've reached your
   limit") or overlay, or an empty page throws `EvidenceBlockedError` with the
   reason. No clip of a wall is ever made. A "Sign in" link or "Already a
   subscriber?" line beside a free article is not a wall.
4. **Freezes** the page (animations and transitions paused, carets hidden,
   media paused), scrolls through it once so lazy content loads, and measures
   every beat target. A target that is missing or hidden is an error.
5. **Shoots** the page once at 2× (up to 7,600 CSS px down; a target further
   down is an error: link to an anchor nearer it) and saves the HTML.
6. **Plays** the beats over that shot: `buildTimeline` turns beats and rects
   into segments, and `stateAt(timeline, t)` reads them at any time with
   nothing carried between frames. The player page draws each frame in px
   (no CSS scale, so a zoom re-samples the 2× shot) and the frames are piped
   to ffmpeg. The same page gives the same frames on every run.

## Outputs

Next to `out`:

- `<id>.mp4` (or `.webm`): the clip.
- `<id>.poster.png`: the last frame, every beat landed.
- `<id>.fullpage.png`: the shot the clip was drawn from (2×).
- `<id>.snapshot.html`: the page's HTML when it was shot.
- `<id>.evidence.json` (`launchclip.evidence.v1`):

```json
{ "schema": "launchclip.evidence.v1", "id": "pr-39217", "kind": "diff",
  "request_url": "…", "final_url": "…", "http_status": 200, "page_title": "…",
  "provenance": { "source_title": "…", "fetched_at": "…", "publisher": "…", "published_at": "…" },
  "captured_at": "ISO", "consent": { "action": "none|rejected|hidden", "via": "…" }, "hidden": ["…"],
  "video": "pr-39217.mp4", "poster": "pr-39217.poster.png",
  "fullpage": { "path": "pr-39217.fullpage.png", "width": 1600, "height": 2737, "scale": 2 },
  "snapshot": { "path": "pr-39217.snapshot.html", "sha256": "…", "bytes": 5006171 },
  "viewport": { "width": 1600, "height": 1000 }, "chrome": 52, "fps": 30, "duration": 9, "frames": 270,
  "spans": [{ "beat": 1, "action": "select", "text": "#39217", "rects": [{ "x": 899.4, "y": 197, "width": 108.4, "height": 38 }] }],
  "beats": [{ "index": 0, "action": "cursor", "at": 0.4, "dur": 0.9, "target": "\"#39217\"", "matched": "#39217", "start": 0.4, "end": 1.3, "box": {} }] }
```

Rects and boxes are page CSS px. `spans` lists every selected or
highlighted phrase as the page actually wrote it.

### `--still`

One hi-res crop for rebuilding the evidence as a card: the target's box
plus `pad`, at `scale` (default 3×), or the top of the page without a
target. Writes `<id>.still.png` and `<id>.still.json` (provenance, final URL,
snapshot sha256, crop box, pixel size). The same consent, block and target
rules apply.

## Into a storyboard

```bash
launchclip evidence scene assets/evidence/pr-39217.evidence.json
```

prints `{module: "evidence-clip", params: {media, viewport, source}}`. Copy
them unchanged; add `focus` or `cursor` only on boxes the sidecar lists.

## Rules for evidence

- Real third-party pages and logos appear only as that party's real
  evidence, captured from their page. Never retype, edit or fake what a page
  says.
- A blocked page is a finding, not something to work round: pick another
  public source, or rebuild the claim as a card that cites it.
