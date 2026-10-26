# RFC: Collections, many videos from one project

Status: draft, open for review
Date: 2026-10-27
Builds on: [SEEDED_STYLES_RFC.md](SEEDED_STYLES_RFC.md) (a style per project),
[VIDEO_QUALITY_RFC.md](VIDEO_QUALITY_RFC.md) (profiles, cut-downs, gates),
[ROADMAP.md](ROADMAP.md) (launch kits)

## 1. Summary

LaunchClip makes one video at a time. Each `launchclip make` run creates a
self-contained project folder, and nothing ties two projects together. People
rarely want one video, though:

- A SaaS founder wants the launch video, a demo, a clip per feature, and the
  Shorts and LinkedIn cuts of each.
- A creator runs a long-form channel and a Shorts channel, or several channels.
- An agency makes videos for several clients, each with their own brand.

These are the same need: **many related videos that share a look, rules and
storage, made in batches without overloading the machine**. This RFC adds that
as a general feature, not a YouTube feature:

- A **library** is a storage root, anywhere (an external drive included).
- A **collection** is a product, a channel, a client or a campaign. It holds
  the brand, style, assets, voice and rules every video in it shares.
- A **recipe** is a repeatable kind of video inside a collection ("launch
  video", "60-second feature clip", "weekly long-form episode"). It fixes the
  format, aspect, length, pacing profile and what each video must vary.
- A **video** is today's project folder, unchanged.

On top of that: a batch planner that plans first and renders after approval, a
machine-wide queue that knows the hardware's limits, and the same rules
written into the skills so an agent can't start ten renders at once.

YouTube, Shorts, TikTok, Reels, LinkedIn, X and Product Hunt become
**destination presets** a recipe can name. That is where the roadmap's launch
kits live too.

## 2. Goals and non-goals

Goals:

- One model that fits a launch kit, a channel, a client, a course and a
  series, with no YouTube-only concepts in the core.
- Settings defined once and inherited: library → collection → recipe → video.
- A long video and its cut-downs are linked, so changing the parent marks the
  children stale.
- Any storage location, checked before work starts.
- Concurrency limited by measured hardware, across every `launchclip` process
  on the machine, whether a terminal or an agent started it.
- Batches of 5 to 100 that you can review at a human pace: approve scripts in
  bulk, review renders by sample past about 50.
- Videos in one collection stay visibly different from each other.

Non-goals:

- Uploading or scheduling posts. Destination presets produce files; posting
  stays a human step (the approval rule in [SKILL.md](../SKILL.md)).
- Distributed rendering across machines. Cloud rendering (Lambda, Cloud Run)
  is a later backend for the same queue, not part of this RFC.
- Topic generation at scale. A batch takes a list of topics; where the list
  comes from is the user's business.
- Changing what one video project looks like on disk. A video made inside a
  collection is still a normal project `finish`, `edit` and `cutdown` work on.

## 3. The model

### 3.1 Library

A folder with a `launchclip.library.json` at its root. It says where things
go:

```json
{
  "schema": "launchclip.library.v1",
  "name": "Roger's videos",
  "storage": {
    "projects": "/Volumes/Footage/launchclip",
    "finals": "/Volumes/Footage/launchclip/_finals",
    "archive": null,
    "min_free_gb": 40
  },
  "cache": "~/.cache/launchclip",
  "collections": ["acme", "thoroughbreds-yt", "thoroughbreds-shorts"]
}
```

- `storage.projects` holds the video projects. It can be an external drive.
- `cache` stays on the internal disk by default: voices, music, models and
  render segments are read often, and a slow drive slows every job.
- `min_free_gb` is checked before each job starts (§5.3).
- With no library file, LaunchClip behaves exactly as today.

The library is found by walking up from the current folder, or from
`--library <path>` / `LAUNCHCLIP_LIBRARY`.

### 3.2 Collection

`<library>/<collection>/collection.json`, beside the brand's files:

```json
{
  "schema": "launchclip.collection.v1",
  "id": "acme",
  "kind": "product",
  "title": "Acme",
  "style": "acme",
  "brand_assets": "brand/",
  "voice": { "engine": "kokoro", "id": "af_heart" },
  "rules": "RULES.md",
  "isolation": "strict",
  "recipes": ["launch", "feature-clip", "release-notes"]
}
```

- `kind` is a label (`product`, `channel`, `client`, `campaign`, `course`) used
  in wording and defaults. The behaviour is the same for every kind.
- `style` names a style pack in the collection's `styles/` or the user's
  styles. With none, the collection gets one seeded style
  ([SEEDED_STYLES_RFC.md](SEEDED_STYLES_RFC.md)) shared by all its videos,
  not a new seed per video.
- `rules` is free text in the project's own words: audience, tone, claims it
  may and may not make, words to avoid, things it never shows. The planner
  and critic read it for every video.
- `isolation: "strict"` (the default) keeps the collection's visual history,
  brand assets and cast to itself. That matters most for client work: nothing
  from one client appears in another client's video.

### 3.3 Recipe

`<collection>/recipes/<id>.json`:

```json
{
  "schema": "launchclip.recipe.v1",
  "id": "feature-clip",
  "title": "60-second feature clip",
  "make": { "format": "promo", "aspect": "9:16", "duration": 60, "goal": "convert" },
  "profile": "shorts",
  "destinations": ["youtube-shorts", "reels", "linkedin"],
  "fixed": { "intro": null, "outro": "outro-cta", "brand_frame": true },
  "vary": ["hook_type", "opening_shot", "layout_mix", "background"],
  "children": [{ "recipe": "feature-clip-landscape", "via": "reframe" }]
}
```

- `make` holds the same options as `launchclip make` today (`--format`,
  `--aspect`, `--duration`, `--goal`, `--awareness`, `--renderer`, …). A
  recipe adds nothing a single `make` can't already do; it saves the choice.
  `profile` is `make --profile` (added in phase 3 for this), and the
  collection's `voice.id` is `make --voice-id`.
- `fixed` lists what is the same in every video of the recipe: a shared intro
  or outro, the brand frame, a caption style.
- `vary` lists what the planner must choose differently from the recent
  videos of the same recipe (§6).
- `children` declares linked outputs: a cut-down (`via: "cutdown"`, today's
  `launchclip cutdown`) or a reframe of the same story to another aspect.
- `destinations` name presets (§3.5).

A collection can be created with no recipes. Then each video is a plain
`make` that inherits the collection's style, voice and rules.

### 3.4 Video

A video is a normal project folder at
`<storage.projects>/<collection>/<recipe>/<slug>/`, with one extra file,
`video.json`, recording where it came from:

```json
{
  "schema": "launchclip.video.v1",
  "collection": "acme",
  "recipe": "feature-clip",
  "recipe_version": "sha256:…",
  "style_version": "sha256:…",
  "parent": null,
  "children": ["../feature-clip-landscape/sso-login"],
  "topic": "SSO login in two clicks",
  "status": "approved-script"
}
```

Phase 3 also records `style` (the style's name), `style_from` (the layer that
chose it: `collection`, `recipe`, `video`, or `make` for a seed make drew
itself; only collection and recipe styles are followed for staleness),
`created_at` and `updated_at`. `status` is one of `planned`,
`approved-script`, `rendering`, `ready-for-review`, `needs-repair`, `ready`,
`approved` or `failed`; `stale` is computed on read, never stored. With no
library, videos go to `<collection>/videos/[<recipe>/]<slug>/`.

The recorded versions of the recipe and style answer "which videos does this
change affect?" Editing a recipe or style marks the videos built on the old
version as stale. Nothing re-renders until the user asks.

Settings resolve in a fixed order: library → collection → recipe → the
video's own flags. The resolved settings are written to the project
(`.launchclip/resolved.json`), so a video renders the same later even if the
recipe has changed since.

### 3.5 Destination presets

A destination is data, shipped in `kit/destinations/`:

| Destination | Sets |
|---|---|
| `youtube` | 16:9, chapters from scene titles, a thumbnail still, captions file (SRT/VTT) |
| `youtube-shorts`, `reels`, `tiktok` | 9:16, ≤ 60 s or the platform's limit, safe zones for the platform's overlays, loop ending |
| `linkedin`, `x` | 1:1 or 16:9, burned-in captions (most people watch muted), length limit |
| `product-hunt` | 16:9, the gallery length limit, a poster frame |

A recipe that names several destinations gets one output per destination
from the same story: a reframe where only the aspect differs, a cut-down
where the length differs. The roadmap's "launch kits" item is a ready-made
`product` collection with a `launch` recipe aimed at all of these.

Ready-made collection templates (`launchclip collection new --template
saas-launch|youtube-channel|client|course`) are starting points only. The
core has no YouTube-only behaviour.

## 4. Batches

### 4.1 The flow

A batch moves each video through five stages, each with a gate:

```
topics ─▶ scripts ─▶ storyboards ─▶ drafts ─▶ finals
          (gate 1:     (script lint,   (finish gates,  (gate 2:
          human        style fit)      critic)         human)
          approval)
```

- **Plan** (`topics → storyboards`) is cheap: model calls and a few seconds
  of local work per video. It runs in parallel.
- **Gate 1** is a human approving scripts in bulk on one review page: approve,
  reject, edit the line, or send back with a note. Nothing renders before
  this.
- **Render** (`storyboards → drafts → finals`) is expensive and runs through
  the machine queue (§5).
- **Gate 2** is the human sign-off on finals that SKILL.md already requires.
  Past about 50 videos it becomes a sample (§4.3).

### 4.2 Commands

```
launchclip library init <path> [--projects <dir>] [--finals <dir>] [--cache <dir>]
launchclip collection new <id> [--kind product|channel|client|campaign|course] [--template <name>] [--style <name>]
launchclip recipe new <collection>/<id> [--from-video <project>] [make flags]
launchclip batch plan <collection>[/<recipe>] --topics topics.csv [--count N]
launchclip batch review <collection>                 # the gate 1 page; bulk approve scripts
launchclip batch render <collection> [--only approved] [--prototype-first]
launchclip batch status <collection> [--json]        # queued, running, done, failed, stale
launchclip batch retry <collection> [--failed]
```

`recipe new --from-video` turns a video the user is happy with into a
recipe: its format, aspect, length, profile and style become the recipe's
settings. That is the usual way to start a series: make one video by hand,
approve it, then make more like it. The source video's `video.json` is then
recorded as made with the new recipe, so editing the recipe marks it stale
too. A style that lived only in that project (a seeded pack) is copied to the
collection's `styles/`.

`topics.csv` has one row per video: `topic`, and optionally `recipe`,
`sources` (URLs, a repo, a file), `assets` (a folder), `priority`, `notes`.

`--prototype-first` renders the opening 20–30 s of every video
(`finish --prototype`) before any full render, so a weak direction is caught
cheaply. It is on by default for the first batch of a new recipe.

### 4.3 What changes with size

| Videos in a batch | Human review | System behaviour |
|---|---|---|
| 1–10 | Watch every final | Plan in parallel, render in turn |
| 10–50 | Approve every script; watch every final | Bulk script approval; resume after failure; failed videos are set aside and don't block the queue |
| 50–100 | Approve every script; watch a sample of finals plus every flagged one | The critic and finish gates review every video in full; release in stages (§4.4) |
| 100+ | Approve recipes and topic lists; skim scripts; sample finals | Supported, not optimised for. Past this size the limits are your machine's hours and the variety checks (§6), not the code |

The sample is drawn per recipe, so a weak recipe can't hide behind a strong
one. Its size is a setting (default: 10% and at least 3 per recipe).

### 4.4 Releasing in stages and pausing on failures

- The first batch of a new recipe renders a **canary** of 3 videos and stops
  for review before rendering the rest.
- A recipe whose gate failure rate passes a threshold (default 30% over its
  last 10 videos) **pauses itself**. Other recipes keep going. `batch status`
  says why it paused and lists the top failure reasons.
- A video that fails its gates after the existing repair passes (`make
  --max-repairs`) is parked as `failed`, with its receipt kept, and is
  skipped. `batch retry --failed` runs them again.

## 5. Storage and the machine queue

### 5.1 Where files go today

Already true and kept as is:

- `make --out <dir>` and `intake --out <dir>` put a project anywhere,
  including an external drive.
- A project's segments, voice, mattes and seeded style live inside the
  project under `.launchclip/`, so the project folder holds nearly all of its
  data.
- `LAUNCHCLIP_HOME` moves styles and models (default `~/.launchclip`).
- `LAUNCHCLIP_CACHE` moves voice, music and isolation caches (default
  `~/.cache/launchclip`).
- `LAUNCHCLIP_BRAND_ASSETS_DIR` moves brand assets.

New: the library's `storage` block replaces passing `--out` per job, and
`finals` collects finished files in one place (as hard links where the
filesystem allows, copies otherwise).

To check in phase 1: where the renderers and Chromium write their temporary
files. If they use the system temp folder, a render to an external drive
still fills the internal disk. Temporary files should go beside the output,
as `recording_edit_media.js` already does.

### 5.2 Hardware capacity

`launchclip doctor --capacity [--json]` measures the machine and recommends a
number of slots for each kind of work:

| Slot | Work | Limited by | Starting rule (to tune against measurements) |
|---|---|---|---|
| `plan` | script, storyboard, critic and repair calls | provider rate limits | 4 (network-bound) |
| `local-model` | Ollama planning, Kokoro voice, subject matting | RAM, GPU | 1, or 2 with 32 GB+ |
| `render` | Chromium frames + encode (`finish`) | CPU cores, RAM, disk speed | min(cores ÷ 5, (RAM − 4 GB) ÷ 7 GB), at least 1 |
| `io` | copying to finals or archive | disk bandwidth | 1 per disk |

On a 10-core, 24 GB Mac that gives 2 renders, 1 local model and 4 planning
calls. The rule is a starting point: phase 2 measures real renders (peak RSS,
CPU time, wall time per rendered second, per renderer and quality) and fits
the rule to them, recorded in `benchmarks/`.

Each render gets an explicit share of the cores (`--concurrency` passed to
Remotion and HyperFrames) instead of today's `auto`, which lets one render
take every core and makes two renders fight.

The user can override any slot in the library file or with
`LAUNCHCLIP_SLOTS=render:1,plan:6`.

### 5.3 The queue

One queue per machine, at `$LAUNCHCLIP_HOME/queue/`, shared by every
`launchclip` process: a batch, a single `make` in another terminal, and
agent sessions.

- A job takes a slot by holding a lock file (`<slot>-<n>.lock`) containing its
  PID, start time and project. A lock whose PID is gone is stale and is
  removed.
- A job that can't get a slot waits and says so (`waiting for a render slot:
  2 of 2 in use by acme/launch, thoroughbreds-yt/ep-14`). It never fails for
  lack of a slot.
- `launchclip queue [--json]` lists what's running and waiting across the
  machine.
- A single `make` with no library uses the same queue, so a solo user running
  two terminals is protected too.

Before a job starts it checks its target: the drive is mounted, it is
writable, and it has `min_free_gb` free. If the drive disappears mid-job, the
job fails cleanly, marks itself `failed` in the job store, and can be resumed
when the drive is back.

### 5.4 Shared caches

Several processes will write the voice, music and segment caches at once.
Phase 1 audits each cache for safe concurrent writes: write to a temporary
name in the same folder, then rename (as `job_store.js` already does). Any
cache that doesn't do this is fixed before batches ship.

## 6. Keeping videos different

At 10 videos a recipe looks like a series. At 50 videos without checks, it
looks like one video with different words. Batches use the variety machinery
that exists and extend it:

- **Visual history per collection.** The `produce` pipeline already compares a
  new plan against recent videos (`creative-plan --visual-history-dir`,
  `--visual-history-limit 8`). `make` doesn't use it yet. This RFC wires it
  into `make` and points it at the collection's history.
- **A collection-wide index.** The last 8 videos is too short for a series of
  50. The history becomes an index of every video in the collection: hook
  text, opening shot, module sequence, background, palette use, thumbnail
  frame. New plans are checked against all of it, weighted towards the same
  recipe and recent videos.
- **`vary` dials.** Each dial a recipe lists must differ from the previous N
  videos of that recipe (default 3). The planner sees the recent choices and
  is told not to repeat them; the lint step enforces it.
- **The roadmap's subject inventory and registry of video tells** apply to
  every video. In a batch, tells are also counted across the whole collection,
  so one device (a quote card, a dissolve) can't become the series' habit.
- **Script similarity.** `batch plan` flags pairs of scripts whose hooks or
  structure are too close, before gate 1, so the human sees them side by side.

## 7. The skills

The subscription-agent skills (`launchclip-create-video`,
`launchclip-create-video-remotion`) and `launchclip-cli` get one shared
reference, `skills-src/shared/batches.md`, with these rules:

1. **Read capacity first.** Before making more than one video, run
   `launchclip doctor --capacity --json` and keep to its slots.
2. **Plan in parallel, render in turn.** Planning can fan out to subagents.
   Rendering goes through `launchclip` commands, which take a queue slot; the
   agent never starts a renderer directly when the CLI can do it.
3. **Never start more render subagents than render slots.** Other agents and
   terminals share the queue; `launchclip queue --json` shows them.
4. **Check the target disk** (mounted, writable, free space) before starting
   and stop cleanly if it disappears.
5. **Use the collection.** Read `collection.json`, the recipe and `RULES.md`
   before planning; don't restate the style per video.
6. **Approve at the gates.** Gate 1 (scripts) and gate 2 (finals) are human
   steps. The agent prepares the review; it doesn't approve on the user's
   behalf.
7. **Report the queue, not a guess.** End with what's done, running, waiting,
   failed and stale, from `batch status --json`.
8. **Size the job.** Up to about 10 videos, the agent can run the batch in its
   own session. Beyond that, it sets the batch up and hands rendering to
   `launchclip batch render`, which keeps running without the agent.

`npm run skills:sync` keeps the shared reference in step across the skills.

## 8. Where it breaks, and what this RFC does about it

| As it grows | What breaks | Answer |
|---|---|---|
| 2+ jobs at once | Renders fight for cores (`auto` concurrency) | Explicit core shares; render slots (§5.2) |
| Several terminals or agents | Nobody sees the others' jobs | One machine queue (§5.3) |
| Long runs | RAM runs out (Chromium + a local model) | `local-model` slot; slots fitted to measurements |
| External drive | Fills up, or is unplugged mid-render | Free-space and mount checks; clean failure; resume |
| Shared caches | Two writers corrupt one file | Write-then-rename audit (§5.4) |
| 50+ videos | Videos look the same | Collection index, `vary` dials, tells counted per collection (§6) |
| 50+ videos | Human review can't keep up | Bulk script approval, sampled final review, canaries, auto-pause (§4) |
| Several clients | Brand assets or history leak between clients | `isolation: "strict"` (§3.2) |
| Recipe or style edits | Unknown which videos are out of date | Version hashes in `video.json`; `stale` status (§3.4) |
| 100+ videos | One machine's hours | Out of scope; a cloud render backend for the same queue later |

## 9. Phases and PRs

Small commits, PRs against main. Phases 1 and 2 don't depend on each other.

| Phase | Lands | Done when |
|---|---|---|
| 0 | This RFC | Reviewed and merged |
| 1 | Storage: `launchclip.library.json`, `library init`, the storage block replacing `--out`, temporary files beside the output, mount and free-space checks, the cache write audit and fixes | A `make` inside a library on an external drive leaves nothing but caches on the internal disk; unplugging the drive mid-render fails cleanly and resumes |
| 2 | Capacity and queue: `doctor --capacity`, render benchmarks in `benchmarks/`, explicit render concurrency, the machine queue and `launchclip queue` | Three `make` runs started at once on a 10-core Mac run 2 renders and queue the third; nothing swaps |
| 3 | Collections and recipes: `collection.json`, `recipe.json`, `video.json`, settings resolving in order, `recipe new --from-video`, stale marking | A recipe made from an approved video produces a second video with the same settings; editing the recipe marks the first video stale |
| 4 | Batches: `batch plan`, `review` (one local page), `render`, `status`, `retry`; canaries, sampling and auto-pause | A batch of 10 from a CSV plans in parallel, waits for approval, renders through the queue, and survives one forced failure |
| 5 | Variety: visual history in `make`, the collection index, `vary` dials in planning and lint, script similarity in `batch plan` | 20 videos from one recipe pass a reviewer's "are these the same video?" check; the similarity report shows no pair over the limit |
| 6 | Destinations and linked outputs: `kit/destinations/`, `children` (cut-down and reframe), launch-kit and channel templates | One `launch` recipe produces the 16:9 video, a Short and a LinkedIn cut, linked; changing the parent marks the children stale |
| 7 | Skills: the shared batches reference, capacity and queue use in all three skills | An agent asked for 8 videos plans in parallel, never holds more render slots than capacity allows, and ends with `batch status` |

## 10. Open questions

1. **Names.** "Project" already means one video folder (`finish <project>`),
   so this RFC uses *collection* for the product, channel or client. Is
   "collection" the right word, or would "brand" or "show" read better in the
   README? "Format" is also taken (`make --format`), hence *recipe*.
2. **One library or many?** Should a user be able to have several libraries
   (personal and agency) with one shared queue, or is one library per machine
   enough?
3. **Review page.** Reuse `production-preview`'s local server for the gate 1
   page, or a static HTML file the CLI writes and opens?
4. **`produce` and `make`.** Batches target `make`, the 0.2.0 path. Should the
   model-directed `produce` pipeline join collections too, or stay one-off?
5. **Cloud rendering.** When it arrives, does it plug in as another kind of
   render slot in the same queue (the queue decides local or cloud per job),
   or as a separate `batch render --cloud`?
6. **Cost.** Batches inherit `--max-cost-usd` per video. Do collections also
   need a collection-wide budget that pauses the batch, or is per-video
   enough?
