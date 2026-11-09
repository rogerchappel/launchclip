# Make a video headlessly

`launchclip make` turns a prompt, plus an optional folder of assets, into a
finished video with one command. No agent session is needed: an API model
writes the script and the storyboard, and LaunchClip's own tooling does the
rest (voice, captions, music and sound effects, rendering, mastering and
quality checks).

If you use a coding agent (Claude Code, Codex), the create-video skills give
you the bespoke, reviewed path instead. `make` is for a hands-off draft.

## Install

```bash
npm install --global launchclip
launchclip doctor
```

You need Node 22+ and FFmpeg (`ffmpeg` and `ffprobe`). The Remotion renderer
downloads Chrome Headless Shell on first use. For talking-head footage or a
voiceover you also need local Whisper (`pip install openai-whisper`); nothing
is sent to a paid transcription service.

## Set a key

Set one model key in your shell or in a `.env` file in the folder you run from:

```bash
OPENAI_API_KEY=...        # default model: openai:gpt-5.6-luna
# or
ANTHROPIC_API_KEY=...     # default model: anthropic:claude-opus-4-8
```

Pick another model with `--model provider:model` (for example
`--model openai:gpt-5.6`, or `openrouter:<vendor>/<model>` with
`OPENROUTER_API_KEY`), or set `LAUNCHCLIP_MAKE_MODEL`.

`ELEVENLABS_API_KEY` is optional. When it is set, the music bed comes from
ElevenLabs (paid) unless you pass `--music synth`. Voices default to the free,
local Kokoro voice.

## Run it

```bash
launchclip make "A 60-second launch video for Ledgerly, which reconciles Stripe payouts" \
  --assets ./assets --aspect 16:9 --duration 60
```

Useful flags:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--assets <dir>` | none | Logos, screenshots, screen recordings, a talking-head clip, a voiceover, `brand.json`, a `style.json`, notes (`.md`/`.txt`). |
| `--aspect` | the recording's shape, else `16:9` | `16:9`, `9:16` or `1:1`. |
| `--duration` | from the prompt, else 30 | The longest the video should run, in seconds. It is a ceiling: a script that runs over is trimmed once, and one with less to say makes a shorter video. Nothing is padded to reach it. |
| `--format` | from the prompt | The kind of script: `short-form`, `long-form`, `explainer`, `data-explainer`, `story` or `promo`. See [Script formats](prompts.md#script-formats-goal-and-awareness). |
| `--goal` | `convert` for a promo, else `reach` | `reach` (views and watch time) or `convert` (an action: sign-ups, sales). |
| `--awareness` | depends on the format | What the viewer already knows: `unaware`, `problem`, `solution`, `product` or `most`. It decides the opening line. |
| `--density` | the style's dial, else off | 0–1. Low lets your footage carry the video: below 0.35, full-frame clips of your `--assets` videos and photos cut to the narration, with short callouts and graphics only for numbers and steps; 0.35–0.5 mixes clips and graphics; 0.5 and up is the motion-graphics plan. |
| `--voice` | `kokoro` | `elevenlabs` is paid. |
| `--music` | finish's default | `synth` (free), `elevenlabs` (paid) or `none`. |
| `--renderer` | `remotion` | Or `hyperframes`. |
| `--quality` | `draft` | `high` renders `renders/final.mp4`. |
| `--out <dir>` | `./launchclip-<slug>/` | The project folder. |
| `--research` | `auto` | Check the brief against primary sources before the script is written. `auto` turns it on for a news or research brief (news wording such as "this week" or "just announced", a dated event, a named release, a question of fact) and leaves it off for a product video or a brief with its own script; `on` and `off` decide it yourself. `MAKE.json` says which and why under `research_decision`. It needs no key: with no web search key, stories come from company feeds, Hacker News, GDELT and Wikipedia's current events, and a brief that asks for "this week" or "the latest" leaves out anything older. Recording source pages needs the optional `playwright` dependency and a Chromium; without them the video is still made, and `MAKE.json`, the warnings and the `research` gate say which claims have no page to show and how to fix it (`launchclip doctor` checks the recorder). See [Research](../RESEARCH.md#in-make). |
| `--replan` | off | Plan a new storyboard on a rerun. |
| `--candidates` | `on` | `off` skips the rendered candidates for the opening and one transition. They need a model that can see. |
| `--concepts` | `on` | `off` skips the five concepts and the story, and writes the script from the brief in one pass. |
| `--no-critic` | critic on with OpenAI, Anthropic and OpenRouter models | Skip the automatic visual review. |
| `--critic-repairs <n>` | `3` | Rounds of repair the critic may ask for (0–3; `0` ships its verdict as is). |
| `--allow-needs-repair` | off | Exit 0 even when the video is `needs-repair` (see [Exit codes](#exit-codes)). |
| `--layout <name>` | `full` | A talking head's layout for the whole video: `full` (the planner picks footage layouts per section) or `stacked` (9:16: the presenter stays in the lower 45% under a graphics panel that changes every sentence, with close-ups on personal lines and one-word captions on the seam) or `overlay` (one continuous full-frame take, graphics in the free space around the presenter, some behind them, one-word captions at chest height). |
| `--base-edited` | off | The talking-head recording or voiceover in `--assets` is already edited by your app: make skips its own edit (bad takes, pauses) and only levels the audio. |
| `--base-transcript <file>` | local Whisper | Word-timed JSON for that recording or voiceover (Whisper's, or `{words: [{text, start, end}]}`): make uses these words and skips Whisper. |
| `--constraints <file>` | `constraints.json` in `--assets` | Hard rules from your app: hidden picture ranges, must-use and never-use media. See [Rules and notes from your app](#rules-and-notes-from-your-app). |

## What it does

1. **Looks at your assets.** Every file is classified (logo, screenshot,
   screen recording, talking head, voiceover, music, brand, notes) and
   described in `ASSETS.json`.
2. **Picks the video type from the inputs, never from the model:**
   - talking-head or podcast footage → the recording is the video, cleaned up
     first (silences, bad takes, filler words), with graphics on the strong
     lines;
   - a voiceover → motion graphics timed to your voice;
   - otherwise → motion graphics with narration the model writes and the local
     voice reads.

   Screenshots and screen recordings are shown in product windows in every
   type.
3. **Chooses a concept, then writes the script** (motion videos only). It
   first decides what kind of video this is (format, goal and viewer
   awareness). Then it drafts five concepts, has a separate model call judge
   them with only the brief and the concepts in front of it, writes the
   winner as a story and has an editor tighten it. `CONCEPTS.json` keeps all
   five with their scores and `STORY.json` the edited story. The script is
   written on that story, to the format's beats, at most as long as your
   duration. A long video's story is a spine of up to three minutes, and its
   chapter outline is derived from it. `--concepts off` skips the concepts
   and writes the script from the brief in one pass; so does a concept stage
   that fails, with a warning. It checks the
   script (see [Check a script](#check-a-script)) and asks the model for one
   rewrite if a check fails, then records the voice. `SCRIPT.json` keeps the
   plan, the beats, three title options and the check report.
4. **Plans the storyboard** from a tested module library. LaunchClip checks it
   (layout, timing, only your real files) and sends errors back to the model
   for up to four repairs.
5. **Tries a second opening and a second transition** (short motion videos,
   with a model that can see). The skill does not commit to its first idea
   for the two moments that decide a video, and neither does `make`. It
   designs a second opening in a separate call that never sees the first,
   and tries a different kind of move at the riskiest transition in the
   first 30 seconds. Each candidate is rendered as three stills at delivery
   size (no encode, no audio, no paid render). The model scores every
   candidate 0–10 on ten fields from the frames alone, and the higher mean
   wins, ties going to the planner's. A winning alternative replaces the
   planner's in `storyboard.json`. The frames and scores are kept in
   `qa/rendered-candidates/` and `qa/rendered-candidates.json`, the receipt
   `cinematic-check` reads, and `MAKE.json` `candidates` says who won and
   why. Long videos and talking-head videos skip this step for now, and
   `--candidates off` skips it everywhere.
6. **Finishes the video:** captions, music and sound effects, rendering,
   mastering to −14 LUFS, and quality gates.
7. **Reviews the frames** with the model when it can see images (OpenAI,
   Anthropic or an OpenRouter route; a local Ollama model needs `--critic`), and
   writes `qa/critic.json`. When the critic asks for a repair, its findings go
   back to the planner (`--critic-repairs`, up to three rounds by default): the scenes
   it named are fixed and rendered again, or the plan is redone when the
   critic asks for a replan or the hook is the problem. The critic then looks
   again. A round that doesn't lower the blocking and major findings is
   undone and the rounds stop, so make never ships a worse cut than the one it
   had. In a long video, a round re-directs the chunks that hold the scenes
   the critic named. Each round is in `MAKE.json` `critic_repairs`. A video
   the critic still won't ship after the rounds is `needs-repair`.

### Exit codes

| Code | `MAKE.json` `status` | Meaning |
| --- | --- | --- |
| `0` | `ready`, `ready-for-review` | The video is finished. `ready-for-review` means a review is still pending (for example, no critic ran). |
| `1` | `failed` | A stage failed; `next_steps` says what to fix. |
| `2` | `needs-repair` | The video rendered, but a gate still fails after the repair rounds. Don't present it as finished. |

Pass `--allow-needs-repair` to get `0` instead of `2`, which is how `make`
behaved before. The report and the video are written either way.

## Record your product with `--repo`

Point `make` at your app's codebase and it records the product demo first, with [demo autopilot](demo-autopilot.md):

```bash
launchclip make "A 45-second launch video for Pulseboard" --repo ~/code/pulseboard
```

Before the script, make starts your app, seeds it, plans 2–4 flows with the same model, records each one into `<project>/assets/demo`, and stops the app. The approved flows reach the script and the storyboard as product-demo clips, each with its params built from its action log, so the zooms, outlines and sound effects land on what really happened in your app.

- **It asks first.** In a terminal, make lists the seed and start commands and waits for a yes, then lists the recorded flows' contact sheets and asks before using them. With no terminal (CI, a script), pass `--approve-demo` to agree to both up front. Without it, make stops after recording, with the review as its next step. Run `launchclip demo approve <project>/assets/demo` and re-run make, which reuses the recording.
- **Same guardrails as `demo record`:** local or staging URLs only (`--allow-host <host>` to opt in), seed data or `LAUNCHCLIP_DEMO_*` test accounts only, and secrets redacted.
- `--demo-plan DEMO-PLAN.json` records your own plan instead of a planned one. `--start` and `--url` override detection, and `--redemo` records again.

## A character story with `--animation`

`--animation` asks for a story told by characters instead of a narrated
motion video:

```bash
launchclip make "A 30-second short: Maya keeps shipping a fix that fails, and Sam shows her the check she skipped" --animation --aspect 9:16
```

**For now it stops after the script and the voice, and renders no video.**
The stages that design the cast, plan the shots and render are being built
([ANIMATION_PIPELINE_RFC.md](../ANIMATION_PIPELINE_RFC.md)). `MAKE.json`
ends with status `stopped`, `stopped.after` is `prepare`, and the later
stages are `skipped`. For a finished video today, leave `--animation` off.

What it does write:

- **`SCRIPT.json`**, a screenplay (version 2): a title, a logline, the
  premise, the characters, and beats whose lines are spoken (by a character
  or the narrator) or silent (an action and its length). A narrator carries
  the story and the characters speak the turns, with two characters unless
  your prompt names more. The format is in
  [KIT_CONTRACTS.md](../KIT_CONTRACTS.md) under "Screenplay".
- **`NARRATION.json`**, the voiced dialogue: one take a line, joined, with a
  `speaker` on every word and the silent lines as pauses.

The script comes from three small model calls, the writers' room: the
premise, the cast and three to five loglines; a second call that sees only
your prompt and the loglines and scores them (the best score is the story);
then the script. It is checked like `launchclip script check <project>`
checks it. If it fails, one repair call fixes it. If it passes but the real
voice runs it more than 15% short of the target, or it fails at the voice's
real pace, that one repair call is spent then instead. Errors left after the
repair are warnings in `MAKE.json`.

Under Kokoro each character borrows a voice of its own until the cast is
designed; with ElevenLabs the narrator's voice reads every line for now. Run
the same command again and the script and the take are reused: no model
call, no new take.

`--animation` needs the motion lane, so it refuses an assets folder that
holds a voiceover or a recording with speech, and a length over 180 seconds.

## Rules and notes from your app

An app that runs make on its users' footage can set hard rules and describe
the media it supplies. LaunchClip still decides how to edit; it never breaks
the rules.

**Rules** go in `constraints.json` in the assets folder (or `--constraints
<file>`):

```json
{ "version": 1,
  "ranges": [ { "start": 4.2, "end": 9.8, "picture": "hidden", "reason": "voiceover_only" } ],
  "media": { "must_use": [ { "src": "broll/pinned-03.mp4", "reason": "pinned" } ],
             "never_use": [ "broll/x.mp4" ] } }
```

- A **hidden** range (seconds on the video's timeline; with `--base-edited`,
  the supplied recording's own time) is covered by full-frame inserts the
  whole way, so the presenter is never seen there while the voice plays on.
  Every line of the direction map over it is an insert line.
- **must_use** files appear at least once, where they fit best.
- **never_use** files are left out of the inventory, never copied into the
  project and refused from `--asset-provider-cmd` (each request lists them in
  `never_use`).

The model is told the rules. If its plan still breaks one, tooling fixes it
without another paid call: it covers a hidden range with the supplied clip
that best matches those words (in its best usable window), and gives a missing
must-use file a scene on the line it matches best. make writes the rules to
`CONSTRAINTS.json` in the project; `launchclip story validate` reports any
broken rule as an error and finish's `constraints` gate fails on one.

**Notes** describe a file: a sidecar `<file>.json` beside it
(`broll/ute.mp4.json`), or one `inventory.json` keyed by path:

```json
{ "version": 1,
  "assets": { "broll/ute.mp4": {
    "description": "Ute crossing corrugations, low angle",
    "subjects": ["ute"], "tags": ["corrugations", "dirt road"],
    "windows": [ { "start": 2.0, "end": 7.5, "quality": 0.9 } ],
    "quality": 0.8, "orientation": "landscape", "people": 1, "faces": false,
    "role": "b-roll" } } }
```

The planner reads them in the asset manifest and picks clips that match the
line, preferring higher quality. A video scene that starts outside a usable
window is moved to the best one. `orientation` overrides the probe, and
`role: "b-roll"` keeps a clip with wind or chatter on it from becoming the
base. Field by field: [Footage inventory notes](../KIT_CONTRACTS.md#footage-inventory-notes-srcinventory_notesjs).

Notes can also say what a file is and where it belongs:

```json
{ "shows": "pricing page",
  "description": "Three plans side by side, the middle one highlighted",
  "text": ["Starter $9", "Pro $29", "Start free"],
  "fits": ["the price or offer line", "the call to action"],
  "feature": true }
```

You do not have to write these. make describes every image and clip you hand
in that has no `shows` or `description` of its own:

- With a model that can take images (an OpenAI or OpenRouter key), it sends
  each new file once (a PAID call per file: the image, or four frames of a
  video) and caches the answer by the file's content, so the same file is
  never sent twice, in this project or any other.
- Without one, it guesses from the file name and folder
  (`screens/pricing.png` is a pricing page), the kind of file, where a clip
  moves, and the words on screen when Tesseract is installed. Name your files
  for what they show and the guess is usually right.

`--asset-descriptions local` never calls a model; `off` skips the step. Your
own notes always win, so an app that already knows what its files show writes
them and pays for no description calls. `ASSETS.json` shows each file's
description and where it came from.

**Featured files.** If you hand in three files or fewer, name a file in the
prompt, ask to "show the pricing page" when one file is the pricing page, or
set `"feature": true` in its notes, make treats the file as one you want in
the video. A storyboard that leaves it out is sent back for repair; if it is
still missing when the repairs run out, the video ships and `MAKE.json` says
so (`assets.unused_featured`, and a `featured:` warning). Use
`media.must_use` when a missing file should fail the run instead.

**Pronunciation and voice** for a synthesised narration go in the assets
folder too (app settings, not assets: never inventoried or copied).
`pronunciation.json` respells terms in the text the voice speaks, and only
there: captions, `NARRATION.json` and word anchors keep the script's spelling.
A term matches whole words (or a phrase), ignoring case, and keeps the
punctuation around it:

```json
{ "SQL": "sequel", "AWS": "A W S", "Ledgerly": "ledger lee" }
```

`voice.json` tunes the voice. Every field is optional; `--voice-id` wins over
`voice`, and ElevenLabs is the provider that honours the settings beyond speed
(Kokoro takes `voice` and `speed` and ignores the rest):

```json
{ "voice": "21m00Tcm4TlvDq8ikWAM", "speed": 1.05,
  "stability": 0.45, "similarity": 0.8, "style": 0.15, "speaker_boost": true }
```

`speed` is 0.5–2 (ElevenLabs clamps it to 0.7–1.2); `stability`,
`similarity` and `style` are 0–1. make writes both into the story as
`audio.narration.pronunciation` and `audio.narration.settings`, so finish
re-voices the same way, and `MAKE.json` lists them under `voice_inputs`.

## Where the output lands

```
launchclip-<slug>/
  renders/draft.mp4        the video (renders/final.mp4 with --quality high)
  publish.json             titles, description, hashtags, CTA and platform fit
  video/cover.png          the designed cover, when the storyboard has one
  MAKE.json                routing and reasons, models, costs, timings, gate results
  storyboard.json          the plan; edit it and run `launchclip finish` to iterate
  CONSTRAINTS.json         your app's rules, when it set any
  SCRIPT.json, NARRATION.json, ASSETS.json, BRIEF.md
  qa/                      contact sheets, evidence, gate reports, critic.json
```

The project folder is `launchclip-<slug>` in the current folder, or `--out`.
Inside a library it goes to the library's projects folder instead, which can be
an external drive: see [Where your videos are stored](storage.md).

The command prints a short summary with the gate results and the next steps.
A failed stage says what to fix. Run the same command again to resume: the
script, storyboard, voice, music and rendered segments are reused.

## Check a script

`make` checks every script it writes before the voice is recorded, and you can
run the same checks on any script:

```bash
launchclip script check SCRIPT.json --brief brief.md
launchclip script check voiceover.txt --duration 30 --brief brief.md --format promo
```

The script can be plain text, `storyboard.json` (`audio.narration`),
`NARRATION.json` or `SCRIPT.json`; the duration comes from the file when it
has one, and `SCRIPT.json`'s plan supplies the format, goal and awareness
unless you pass `--format`, `--goal` or `--awareness`. `--brief` takes the prompt, notes and transcripts the script was
written from (repeat it for several files). It exits 1 when there are errors
and prints the fix for each one.

A project folder works too: `launchclip script check <project>` checks its
`SCRIPT.json`. When that file is a screenplay (version 2: speakers and silent
lines, for a story told by characters), the check first validates the
contract: every speaker is a listed character or the narrator, every listed
character speaks or acts, the script fits `--duration` at `--wpm`, and the
problem lands inside the profile's limit. Then the spoken lines pass the same
checks as any narration. The format is in
[KIT_CONTRACTS.md](../KIT_CONTRACTS.md) under "Screenplay".

Errors are kept for rules that are arithmetic, legal or universal:

- **The clock:** more words than the duration can hold at 2.75 words a second.
- **Facts:** every number, percentage, price and multiple, every quote, every
  "trusted by", rating, "#1" or award, and every deadline or "only N left"
  must be in the brief. "40 per cent" matches "40%", "three times" matches
  "3x", and a brief's 43.7% supports "44 per cent" or "about 4 in 10". Small
  counts such as "two steps" are not checked; "3 clicks" and "five minutes"
  are.
- **The opener:** no greeting or filler ("hey guys", "in this video",
  "today we're going to"), and a first sentence of 12 words or fewer (15 for
  long-form and story).
- **One call to action**, in the final quarter. Long-form may add one softer
  call earlier to the same place. Pass `--cta "..."` to require a particular
  one.
- **No sentence over 25 words.**

Warnings cover the house style: long sentences on average, a reading grade
above 7 (9 for a B2B brief), too many sentences starting with "and" or
"also", the product named in the first sentence for an `--awareness unaware`
or `problem` audience (with `--product`), hype words with no number or
mechanism behind them, two numbers in one sentence, figures too precise to
hear, a hook question the ending never answers, and a narration rate outside
the format's band. Most thresholds come from the research in
`reports/`; the ones the evidence does not fix are LaunchClip defaults.

In `make`, the check report is stored in `SCRIPT.json` (`check`) and
summarised in `MAKE.json` (`script.check`). If errors survive the one rewrite,
make keeps going and lists them as warnings.

## The cover and publishing

For a Short (9:16, 60 s or less) the planner sets a `cover` in the
storyboard: one number or a short question that echoes the hook, such as
`{"text": "Protein. All at once?", "number": "100g"}`. The video opens on it
as a 1.5 s title card, so the first frame reads on its own in a profile grid,
and `finish` renders the same card to `video/cover.png` as the thumbnail. Set
`"frame": <seconds>` to keep the opening as it is and name the frame a cover
picker should use instead.

Every finished video also gets `publish.json`: the title and title options
from the script, a description, hashtags, the CTA, the aspect, duration, video,
cover and any `.srt`/`.vtt` captions, and whether the video fits YouTube
Shorts (vertical, at most 180 s), TikTok, Reels, YouTube, LinkedIn (which
recommends 15–30 s) and X. When research brought in photos or footage, it
also lists `credits` (the licence and attribution of each item used, added
to the description too) and `sources` (each source page shown on screen).
Write it again with a tracking link:

```bash
launchclip publish-manifest launchclip-ledgerly --link https://ledgerly.dev --utm spring-launch
```

`--utm` tags the link per platform (`utm_source=<platform>&utm_medium=video&utm_campaign=<campaign>`).
`--platforms app_store,product_hunt` adds the App Store (previews run 15–30 s)
and Product Hunt (a YouTube link, and a CTA that does not ask for upvotes).

## A series that doesn't repeat itself

When you make several videos for one product or channel, point every run at
the same history folder:

```bash
launchclip make "A 30-second video on Ledgerly's payout matching" --visual-history-dir ~/videos/ledgerly-history
launchclip make "A 30-second video on Ledgerly's month-end close" --visual-history-dir ~/videos/ledgerly-history
```

Each finished video (`ready` or `ready-for-review`) is recorded in
`launchclip-history.json` in that folder: its hook, opening shot, module
sequence, background, caption preset, palette and cover. The next run then:

- **tells the planner** what the last 8 videos chose (`--visual-history-limit`
  changes how many), so it opens on a new hook and picks a different module
  sequence;
- **moves a repeated look**: if the background or caption preset matches one
  of the last three videos, make switches it to one they did not use. A style
  you chose with `--style` keeps its own background and captions; only
  generated looks move;
- **lints the plan** against every video in the history, weighting recent
  ones more, so a near-copy of last week's video is flagged sooner than one
  from a year ago. Findings appear as `variety:` warnings and in `MAKE.json`
  (`variety`) and `.launchclip/variety.json`. They never stop the render;
  `--replan` plans again. `--visual-similarity-limit` (default 0.6) sets how
  alike is too alike.

A rerun of the same project keeps its storyboard and replaces its own entry
in the history.

To compare a whole set before you render, run:

```bash
launchclip history check ~/videos/ledgerly-history
```

It reads the history and any project folder inside it that has a
`storyboard.json`, and lists every pair whose hooks or structure are too
close. It exits 1 when it finds one; `--json` gives the full report.

## Cost

- Every paid call is announced before it is made (`model: PAID call to …`),
  and `MAKE.json` records each call's tokens and estimated cost.
- Each command stops starting paid calls once it has spent $50. Change the
  limit with `--max-cost-usd <amount>` or `LAUNCHCLIP_MAX_COST_USD`, or pass
  `none` to remove it. Calls already running finish, and a rerun starts a new
  $50 budget.
- With `gpt-5.6-luna`, one run costs roughly $0.05–0.15 of model time: one
  script pass, maybe one repair and one resize, one storyboard pass plus up to four repairs
  (about $0.015 each), and one critic pass over the contact sheets ($0.02–0.04).
  A critic repair round adds a storyboard repair, the re-render and a second
  critic pass. The concept and story stage adds four calls before the script
  (five concepts, the judge, the story and its edit); the figures here were
  measured before it existed, so check `MAKE.json` for what a run costs now,
  or pass `--concepts off`.
  In testing, a 45 s motion video cost about $0.12 and a 17 s footage-led
  video about $0.08.
- Kokoro voice, the synth music bed, Whisper transcription, rendering and
  mastering are local and free.
- ElevenLabs voice or music is paid. A generated track is locked to the
  project and cached, so reruns do not pay again.

## Limits

- The headless critic only sees contact sheets: no audio and no full-motion
  playback. Treat its verdict as a first pass, not final sign-off.
- With an Anthropic model the critic stays pending (the adapter sends text
  only); review `qa/critic-sheets/` yourself.
- A single logo has no dedicated module yet, so the storyboard usually leaves
  it out.
- Classification uses simple local signals (speech activity, frame
  flatness and edges, filenames). Check `ASSETS.json`, and rename a file (for
  example `logo.png`, `demo.mp4`, `voiceover.wav`) if it was misread.
