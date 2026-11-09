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

To see what your keys cover before you spend anything, run:

```bash
launchclip doctor --models
```

It reports whether you have a model that can write (the script, the cast
and the storyboard) and one that can see (the critic), and names what is
missing. It reads your environment and, if you run Ollama, asks it which
models are installed. It makes no paid call. Add `--json` for a script, or
`--model provider:model` to check a model other than the default. `make`
writes the same report into `MAKE.json` as `model_access`.

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
| `--duration` | from the prompt, else 30 | Target length in seconds. The video is sized to the real narration. |
| `--format` | from the prompt | The kind of script: `short-form`, `long-form`, `explainer`, `data-explainer`, `story` or `promo`. See [Script formats](prompts.md#script-formats-goal-and-awareness). |
| `--goal` | `convert` for a promo, else `reach` | `reach` (views and watch time) or `convert` (an action: sign-ups, sales). |
| `--awareness` | depends on the format | What the viewer already knows: `unaware`, `problem`, `solution`, `product` or `most`. It decides the opening line. |
| `--density` | the style's dial, else off | 0–1. Low lets your footage carry the video: below 0.35, full-frame clips of your `--assets` videos and photos cut to the narration, with short callouts and graphics only for numbers and steps; 0.35–0.5 mixes clips and graphics; 0.5 and up is the motion-graphics plan. |
| `--voice` | `kokoro` | `elevenlabs` is paid. |
| `--music` | finish's default | `synth` (free), `elevenlabs` (paid) or `none`. |
| `--renderer` | `remotion` | Or `hyperframes`. |
| `--quality` | `draft` | `high` renders `renders/final.mp4`. |
| `--out <dir>` | `./launchclip-<slug>/` | The project folder. |
| `--replan` | off | Plan a new storyboard on a rerun. |
| `--no-critic` | critic on when the model takes images | Skip the automatic visual review. OpenAI, Anthropic and OpenRouter models take images; a local Ollama model does not. |
| `--critic-repairs <n>` | `1` | Rounds of repair the critic may ask for (0–3; `0` ships its verdict as is). |
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
3. **Plans and writes the script** (motion videos only). It first decides
   what kind of video this is (format, goal and viewer awareness), then
   writes to that format's beats, sized to your duration. It checks the
   script (see [Check a script](#check-a-script)) and asks the model for one
   rewrite if a check fails, then records the voice. `SCRIPT.json` keeps the
   plan, the beats, three title options and the check report.
4. **Plans the storyboard** from a tested module library. LaunchClip checks it
   (layout, timing, only your real files) and sends errors back to the model
   for up to four repairs.
5. **Finishes the video:** captions, music and sound effects, rendering,
   mastering to −14 LUFS, and quality gates.
6. **Reviews the frames** with the model when it can see images (OpenAI), and
   writes `qa/critic.json`. When the critic asks for a repair, its findings go
   back to the planner (`--critic-repairs`, one round by default): the scenes
   it named are fixed and rendered again, or the plan is redone when the
   critic asks for a replan or the hook is the problem. The critic then looks
   again. A round that doesn't lower the blocking and major findings is
   undone, so make never ships a worse cut than the one it had. Each round is
   in `MAKE.json` `critic_repairs`.

## Record your product with `--repo`

Point `make` at your app's codebase and it records the product demo first, with [demo autopilot](demo-autopilot.md):

```bash
launchclip make "A 45-second launch video for Pulseboard" --repo ~/code/pulseboard
```

Before the script, make starts your app, seeds it, plans 2–4 flows with the same model, records each one into `<project>/assets/demo`, and stops the app. The approved flows reach the script and the storyboard as product-demo clips, each with its params built from its action log, so the zooms, outlines and sound effects land on what really happened in your app.

- **It asks first.** In a terminal, make lists the seed and start commands and waits for a yes, then lists the recorded flows' contact sheets and asks before using them. With no terminal (CI, a script), pass `--approve-demo` to agree to both up front. Without it, make stops after recording, with the review as its next step. Run `launchclip demo approve <project>/assets/demo` and re-run make, which reuses the recording.
- **Same guardrails as `demo record`:** local or staging URLs only (`--allow-host <host>` to opt in), seed data or `LAUNCHCLIP_DEMO_*` test accounts only, and secrets redacted.
- `--demo-plan DEMO-PLAN.json` records your own plan instead of a planned one. `--start` and `--url` override detection, and `--redemo` records again.

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
recommends 15–30 s) and X. Write it again with a tracking link:

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
  critic pass.
  In testing, a 45 s motion video cost about $0.12 and a 17 s footage-led
  video about $0.08.
- Kokoro voice, the synth music bed, Whisper transcription, rendering and
  mastering are local and free.
- ElevenLabs voice or music is paid. A generated track is locked to the
  project and cached, so reruns do not pay again.

## Limits

- The headless critic only sees contact sheets: no audio and no full-motion
  playback. Treat its verdict as a first pass, not final sign-off.
- With a local Ollama model the critic stays pending (that client sends
  text only); review `qa/critic-sheets/` yourself. `launchclip doctor
  --models` says so before you start.
- The critic's cost follows the model. The figures above are for
  `gpt-5.6-luna`; the Anthropic default is a larger model and its critic
  pass costs more. `MAKE.json` records what each call cost.
- A single logo has no dedicated module yet, so the storyboard usually leaves
  it out.
- Classification uses simple local signals (speech activity, frame
  flatness and edges, filenames). Check `ASSETS.json`, and rename a file (for
  example `logo.png`, `demo.mp4`, `voiceover.wav`) if it was misread.
