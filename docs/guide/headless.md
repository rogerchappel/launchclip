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
| `--model-concurrency <n>` | `4` | How many model calls may be in flight at once (1–32), or set `LAUNCHCLIP_MODEL_CONCURRENCY`. `1` sends one call at a time. The video is the same at any value. See [What runs at the same time](#what-runs-at-the-same-time). |
| `--speed` | `standard` | `draft` makes a fast draft: a planned, playable video in about the time it takes to write and voice the script, with nothing rendered. See [A fast draft](#a-fast-draft-with---speed-draft). |
| `--draft-model <provider:model[@effort]>` | the run's model at `low` reasoning | The model a draft's calls use, or set `LAUNCHCLIP_DRAFT_MODEL`. |
| `--refine` | off | Continue a draft project to the full-quality plan, keeping its script and its voice. |
| `--research` | `auto` | Check the brief against primary sources before the script is written. `auto` turns it on for a news or research brief (news wording such as "this week" or "just announced", a dated event, a named release, a question of fact) and leaves it off for a product video or a brief with its own script; `on` and `off` decide it yourself. `MAKE.json` says which and why under `research_decision`. It needs no key: with no web search key, stories come from company feeds, Hacker News, GDELT and Wikipedia's current events, and a brief that asks for "this week" or "the latest" leaves out anything older. Recording source pages needs the optional `playwright` dependency and a Chromium; without them the video is still made, and `MAKE.json`, the warnings and the `research` gate say which claims have no page to show and how to fix it (`launchclip doctor` checks the recorder). See [Research](../RESEARCH.md#in-make). |
| `--replan` | off | Plan a new storyboard on a rerun. The script, the voice and every other finished step are reused unless your own inputs changed (the prompt, your notes, the files you handed in, the flags). Clips your asset provider wrote into `--assets` during an earlier run do not count as a change: see [Clips your asset provider fetched](#clips-your-asset-provider-fetched). |
| `--explainer` | `visual` | What a video with nothing to show is made of. `visual` draws every scene for the topic; `characters` has a small cast carry it. See [A visual explainer](#a-visual-explainer-when-there-is-nothing-to-show). |
| `--candidates` | `on` | `off` skips the rendered candidates for the opening and one transition. They need a model that can see. |
| `--concepts` | `on` | `off` skips the five concepts and the story, and writes the script from the brief in one pass. |
| `--no-critic` | critic on when the model takes images | Skip the automatic visual review. OpenAI, Anthropic and OpenRouter models take images; a local Ollama model does not. |
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
   for up to four repairs. What tooling can settle never costs a repair or
   fails the run. A card that sits in the caption band is one of those, and
   the captions stay on screen: the card moves out of the band (above or
   below it, re-fitted if it must be; a clip's label takes its other slot);
   a scene whose content cannot move has the captions moved for that scene
   to the nearest free band, at their size; with no band tall enough they
   shrink, to 70% at least; and only then are they hidden under the card.
   `MAKE.json` `warnings` says which (`layout: tooling cleared the caption
   band: s3 (moved above it)`, `layout: tooling placed captions 15–18 s moved
   below s5 (y 1171)`, `layout: tooling hid captions 3.94–6.02 s under s3:
   …`). That covers a style whose captions sit at the top, in the middle or
   low in the frame, at any size: the planner is told where that band is and
   to plan scene text clear of it, and the check measures the band the
   captions really take. Captions hidden for more than 15% of the narration
   fail the storyboard (`captions: …` names the scenes) and, in `finish`,
   the `captions` gate.
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
| `3` | `awaiting-approval` | The run stopped where you asked it to (`--stop-after storyboard`): the video is planned, nothing is rendered. See [Plan first, render on demand](#plan-first-render-on-demand). |

Pass `--allow-needs-repair` to get `0` instead of `2`, which is how `make`
behaved before. The report and the video are written either way.

## Plan first, render on demand

A render is the slow part of a run, and the plan is the part a person waits
to see. `--stop-after storyboard` stops the run once the video is planned,
with everything a browser player needs to play it, and renders nothing:

```bash
launchclip make "<prompt>" --assets ./assets --out ./video --stop-after storyboard   # ends awaiting-approval, exit 3
# play ./video in a browser player; edit storyboard.json if you want
launchclip make "<prompt>" --assets ./assets --out ./video --stop-after storyboard --approve storyboard   # renders it
```

The first command runs every stage up to the storyboard, then a `plan`
stage: the voice, the captions and the sound (music bed, sound effects and
the mix) are made, the story is resolved, and the checks that need no
rendered pixels run. No renderer and no browser starts. `MAKE.json` ends
`status: "awaiting-approval"` with `stopped.after: "storyboard"`, and
`next_steps` says how to render.

The second command is the first plus `--approve storyboard`. It reuses every
finished step (the script, the voice, the storyboard, the captions, the
sound: no model call, no new audio) and goes on to the render, the gates
and the critic. `launchclip finish ./video` renders a planned project too
(`next_steps` has the command with the same `--music` and `--sfx`); it
writes `finish.json` but not `MAKE.json`, and no critic runs. On the same
inputs the rendered video is the one an uninterrupted run makes.

An approval is of a storyboard that exists. If the approving run has to plan
again (the prompt or the assets changed, or `--replan`), it stops again with
the new plan. The candidates stage (the rendered comparison of the opening
and one transition) does not run in this mode, before or after the approval:
the story you were shown is the story that is rendered.

### Play the plan in a browser

```bash
launchclip preview ./video                    # serves the player on http://localhost:4173 and opens it
launchclip preview ./video --export ./player  # writes the same player as static files and stops
```

`launchclip preview` plays a planned project before any render. It compiles
the resolved story to the page the HyperFrames renderer draws, and puts a
player around it that drives the page's timeline from the clock of the mix:
play, pause, scrub and mute. No renderer starts and no model is called, so
it takes a second or two. It works on any planned project: after
`--stop-after storyboard`, after `--speed draft`, and again after `--refine`
or an edit to `storyboard.json` (run it again to see the new plan).

The player is a folder of static files, written to `.launchclip/preview` in
the project, or to the folder `--export` names:

```
index.html         the player (index.html?bare hides its controls)
composition.html   the video: one page, one paused timeline
preview.json       the format, the title, draft or full plan, the story's sha256
assets/ fonts/     the media and the fonts the page uses
vendor/            the animation library, so the page needs no network
```

A host serves that folder and shows `index.html` in a frame. The page takes
`launchclip:play`, `launchclip:pause` and `launchclip:seek` (`{type, time}`)
messages from its parent and posts `launchclip:ready`, `launchclip:time` and
`launchclip:ended` back. It has to come from a web server: a browser will
not play it from `file://`.

What the preview is not: the sound is the unmastered mix, a caption plate
added after measuring rendered frames is not there, and nothing that needs
rendered pixels (the pixel gates, the critic) has run. `preview.json` lists
these under `not_in_preview`.

### What a planned project holds

```
video/
  PLAYER-MANIFEST.json                    every file a player needs: role, size, sha256
  .launchclip/finish/story.resolved.json  the resolved story, as the renderers read it
  storyboard.json                         the plan you can edit
  NARRATION.json                          the narration's word timings
  assets/audio/narration.wav              the narration
  assets/captions/captions.json           the captions, as the renderers draw them
  assets/audio/mix.wav                    narration, music bed and sound effects, mixed (not mastered)
  assets/…                                every image, clip and matte the story names
  MAKE.json, finish.json                  the reports (finish.json has status "planned")
```

`PLAYER-MANIFEST.json` (`launchclip.player-manifest.v1`):

| Field | What it is |
| --- | --- |
| `story` | The resolved story's path in the project. This is the story to hand a player. |
| `format` | `width`, `height`, `fps`, `duration`. |
| `files[]` | `{path, role, bytes, sha256, player}`. `player: true` files are the ones the story names, so a player fetches them; `player: false` files are inside the mix already and listed for a host that wants them apart. |
| `missing[]` | Paths the story names that are not in the project (also a warning). Empty in a healthy plan. |
| `bytes` | The size of the `player: true` files together. |
| `audio` | `track` (the one audio file the player mounts), `narration`, `words`, `music` (`{provider, file}` or null), `sfx` (`{mode, cues}` or null), `mastered: false`. |
| `not_in_preview[]` | What a preview will not match (below), in words. |

Roles: `story`, `words` (NARRATION.json), `captions`, `mix`, `narration`,
`base` (a footage-led recording), `subject` (presenter mattes), `media`
(every other image or clip), and with `player: false`: `music` (the bed on
its own) and `sfx-cues` (the cue list, `assets/audio/cues.json`).

The music bed and the sound effects are decided at plan time: they are in
`assets/audio/mix.wav`, which is the track the player plays. With `--music
elevenlabs` or generated sound effects the plan stage makes the paid calls a
render would have made, and the render reuses them. When a story has no
music and no effects, there is no mix: `audio.track` is the narration and
`audio.mix_skipped` says why.

### Playing it in a browser

The kit's Player props take the resolved story as it is
([`@launchclip/remotion`](../../kit/remotion/README.md)):

```jsx
import { Player } from '@remotion/player';
import { setAssetResolver, storyPlayerProps } from '@launchclip/remotion';

// 1. Upload every manifest file with player: true; keep a map of path -> URL.
// 2. Point the kit at the URLs, once, before the first frame.
setAssetResolver((src) => urls[src] ?? null);
// 3. The story is the manifest's `story` file, parsed.
const props = await storyPlayerProps(resolvedStory);
<Player {...props} controls />;
```

`storyPlayerProps` fetches the captions through the resolver; the Player
fetches the mix and the media the same way. Every path either of them asks
for is a `player: true` file in the manifest. A file's `sha256` is its
content hash, so a host can skip an upload it already has.

After an edit to `storyboard.json`, `launchclip finish ./video --plan-only`
(with the `--music` and `--sfx` of the run) refreshes the resolved story, the
audio that changed and the manifest, again without rendering.

### The checks at plan time, and the ones that wait for the render

`MAKE.json` `plan.checks` has every check that reads the plan and not the
pixels, so a host can show a problem before anyone pays for a render:

- `script`: the script's own checks (its reading time against the clock,
  the brief), from the prepare stage.
- `storyboard`: whether the plan passed first time and how many repair
  passes it took. A plan that fails its checks (story validation, layout,
  the caption band, the cast, the script's line ids) fails the storyboard
  stage as it always has.
- `gates`: `placeholders`, `layout` (safe zones, overlaps, the caption
  band, reading time), `physics`, `ghosting`, `density`, `variety`, `holds`,
  `states`, `direction`, `acting`, `coverage`, `structure`, `hook`, and when
  they apply `cast`, `bible`, `subject`, `lip-sync`, `face`, `constraints`,
  `base_edit_qa` and `research`. Each has a `status` and its findings.
- `status` and `failed`: `failed` when any gate failed, with their names. A
  failing check does not fail the run or change its status: it is reported
  (and warned about), because the render's gate would fail the same way.
- `needs_render`: the gates that read the rendered video and so have not
  run: `loudness`, `motion`, `audio`, `temporal_evidence`, `style` and
  `critic`. Two parts of plan-time gates wait as well: the layout gate's
  caption legibility (measured on frames) and the structure gate's check of
  the opening's pixels.

`MAKE.json` `gates` stays `null` until a render: it is the rendered video's.

### What the preview will not match

- **Loudness.** The player plays the unmastered mix. The render masters the
  video to -14 LUFS and -1 dBTP, so levels differ slightly.
- **Caption plates from the render.** A caption line predicted to cross a
  character or a card already has its plate. A line the render measures as
  illegible gets a plate and a second pass; the preview does not have those.
- **Pixel gates and the critic.** Motion, audio, temporal evidence, style
  and the critic judge rendered frames. A critic repair round can change
  scenes after the approval (`--critic-repairs 0` or `--no-critic` keeps the
  rendered story the approved one).
- **The cover and `publish.json`** are written with the rendered video.
- **The renderer.** The Player draws with the Remotion kit. A `--renderer
  hyperframes` render is held to parity with it, not to identical pixels.

### How long planning took

`MAKE.json` `plan.timings` has `seconds` (the whole plan), `stages` (each
make stage, as in `timings`) and `steps` (the plan stage's own: `voice`,
`validate`, `captions`, `sound`, `plan`). The progress lines name the stage
and its steps: `launchclip:progress {"stage":"plan","step":"sound"}`.

A character story (`--animation`) can stop here too. Its show bible is
still drawn with a browser (the reference sheets), and its animatic is made
after the approval.

## A fast draft with `--speed draft`

```bash
launchclip make "A 30-second explainer on why sourdough needs a starter" --speed draft --out ./sourdough
```

A draft is for the first look. It gets to a planned video (a script, a
voice and a storyboard a player can show) as fast as it can, and renders
nothing. What it does differently from the ordinary run:

| Part | The ordinary run | A draft |
| --- | --- | --- |
| Script | Research when the brief calls for it, five concepts and a judge, the story and its edit, the script, a repair pass and a resize pass | One call from the brief, streamed, on the plan's hard word ceiling. Tooling cuts whole sentences from a script that is over it, and ends a script without a call to action on one |
| Voice | One take of the whole narration, after the script | One take a sentence, started while the script is still being written (four at a time for a hosted voice, one after another for the local one), then joined into one narration |
| Storyboard | A direction map, then the storyboard, with up to four repair calls | Made by rule at once: the narration is cut into lines of a few seconds, and each line gets a character of a small cast beside the line's own words, with the call to action last. Beside it, one fast call may recast the characters for the topic and rewrite their acting and the card words |
| Shots | Asked for as the planner goes | Every request goes to your asset provider at once, and each has 8 s to answer. A clip that is late is not waited for: its scene is drawn instead |
| After the plan | Candidates, the render, the critic and its repair rounds | The [plan-only](#plan-first-render-on-demand) stop: the captions, the mix and `PLAYER-MANIFEST.json` for a browser player, on the synth bed and the kit's sound effects unless you pass `--music` or `--sfx`. Nothing is rendered |

Every check that needs no pixels still runs on a draft, and so do tooling's
own corrections (scene lengths, reading time, the caption band, cues), so
the storyboard is a valid one. If the rule-made plan ever fails a check, a
plainer one (a character beside every line, no clips or diagrams) is
planned in its place.

The one direction call has a deadline, 12 s by default. If the model has not
answered by then, answers with something the kit cannot draw, or its
storyboard fails a check, the rule-made plan stands and the run goes on.
`MAKE.json` says which happened.

A host reads the same progress lines as ever, plus four steps:

```
launchclip:progress {"stage":"prepare","step":"sentence","index":1,"text":"Why does sourdough need a starter?"}
launchclip:progress {"stage":"prepare","step":"script","status":"ready","words":78,"seconds":6.1}
launchclip:progress {"stage":"prepare","step":"voice","status":"ready","seconds":7.4}
launchclip:progress {"stage":"storyboard","step":"plan","status":"ready","seconds":13.9}
```

`sentence` is written as each sentence of the script arrives, so you can
show the script while it is being written. `seconds` counts from the start
of the run.

The run ends as `--stop-after storyboard` does: `status`
`awaiting-approval`, `stopped.after` `storyboard`, exit code 3, and the
project holds everything a browser player needs (see [Plan first, render on
demand](#plan-first-render-on-demand)). `MAKE.json` has that mode's `plan`,
and records what was made the fast way:

```json
"milestones": { "first_sentence_seconds": 3.2, "script_seconds": 6.1, "voice_seconds": 7.4, "plan_seconds": 13.9, "player_seconds": 15.2 },
"draft": {
  "mode": "draft",
  "parts": { "script": "draft", "voice": "draft", "storyboard": "draft", "render": "none" },
  "model": { "spec": "openai:gpt-5.6-luna", "reasoning": "low" },
  "script": { "streamed_sentences": 8, "words": 78, "word_ceiling": 82 },
  "voice": { "sentences": 8, "at_once": 4, "joined": true },
  "storyboard": {
    "source": "rules+direction",
    "direction": { "status": "applied", "seconds": 5.8, "changed": 6 },
    "shots": { "asked": 3, "answered": 2, "late": 1, "deadline_seconds": 8 }
  }
}
```

`milestones` counts from the start of the run (a draft and a refine have
it): `plan_seconds` is the storyboard, `player_seconds` the project ready
for a player. `storyboard.source` is `rules` when the direction call did
not make it in; `direction.status` is then `late`, `failed`, `invalid` or
`off`.

### What a draft gives up

- **The writing.** No research, no concepts, no story pass, and no repair:
  a script check that fails is a warning in `MAKE.json`. A take that runs
  over the target length is kept (there is no resize pass).
- **The voice's flow.** Sentences are voiced apart, so the read does not
  carry from one sentence into the next as a single take does.
- **Design.** The storyboard is a character beside the line's words in most
  scenes. There are no charts, no library skeleton and its key shot, no
  designed opening, and no cadence profile behind the cuts.
- **Review.** Nothing is rendered, so no gate that needs frames has run, and
  no critic has looked at it.
- **Research is off**, whatever `--research` says.

A recording as the base (a talking head), `--animation` and a long video are
planned the ordinary way under `--speed draft`; the run still stops at the
plan.

### From the draft to the full plan

```bash
launchclip make "A 30-second explainer on why sourdough needs a starter" --out ./sourdough --refine
```

`--refine` continues a draft project. The script and the voice are kept as
they are, so the timings do not move; the direction map and the storyboard
are planned the ordinary way, with their repair calls. `storyboard.json` is
replaced when the plan passes, and the draft's is kept at
`.launchclip/draft/storyboard.json`. A host can show the draft at once, run
this in the background and swap the plan in when it ends. It takes as long
as an ordinary run's planning (minutes), and when the model's storyboard
fails its checks the run fails as an ordinary one does: `storyboard.json` is
then still the draft's, so keep showing it. `MAKE.json` then
has `draft.mode` `refine` and `draft.parts` `{"script": "draft", "voice":
"draft", "storyboard": "refined", "render": "none"}`.

Both stop at the plan. `launchclip finish <project>`, or the same command
with `--approve storyboard`, renders whichever storyboard is in the project.

### Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `--draft-model`, `LAUNCHCLIP_DRAFT_MODEL` | the run's model at `low` | The model for the draft's two calls, for example `openai:gpt-5.6-luna@low`. |
| `LAUNCHCLIP_DRAFT_DIRECTION_MS` | `12000` | How long the draft waits for the direction call. `0` sends none: the draft is one model call. |
| `LAUNCHCLIP_DRAFT_SHOT_MS` | `8000` | How long each shot request may take before its scene is drawn. |

How long a draft takes, measured, and what stands between it and the length
of the video: [benchmarks/MAKE_FAST_DRAFT.md](../../benchmarks/MAKE_FAST_DRAFT.md).

## A visual explainer when there is nothing to show

A prompt with no recording, no images and no asset provider has no picture
of its own. `make` then plans a visual explainer: every scene is a picture of
what the narration says at that moment, drawn for the topic in an
editorial-illustration style and timed to the spoken words. A video about
deck materials shows the boards, the joists and what happens to each in the
sun, not a character talking beside captions.

```bash
launchclip make "3 common deck materials in Australia" --aspect 9:16 --duration 30 --stop-after storyboard --model-concurrency 16
launchclip preview ./launchclip-3-common-deck-materials-in-australia
```

It is planned in two steps:

1. **One call directs.** The director reads the narration with the time of
   every word and writes the look every scene follows, the scenes (their
   times, what each shows, what lands on which word, where a sound goes) and
   the shared props: drawing code for the things that recur, so scenes drawn
   apart still match.
2. **Every scene is drawn at once.** Each scene is its own call, given the
   look, the props and its own beats. `--model-concurrency` sets how many are
   in flight; at the default of 4 a nine-scene video draws in three rounds,
   at 16 in one.

How a scene uses the frame:

- **The picture fills it.** Ground, benches and big objects run to the
  bottom edge; nothing below the captions is left as bare background.
- **Text stays where it can be read:** inside the platform's safe zone and
  above the caption line, in type of 30 px or more.
- **Captions sit on top of the picture,** one or two words at a time. The
  director may hide them in a scene whose own big type carries the spoken
  words, in at most half the scenes and never in the opening.
- **The camera never stops:** a slow push for the whole scene, and a punch
  in on the director's hits.

A scene's code is parsed and held to the [custom-module rules](../KIT_CONTRACTS.md)
before it is used. A scene that fails is drawn once more with the reason, and
a call the provider refused is sent again once the other scenes are drawn. One
that fails again shows its heading as a card, and the run warns about it; a
video where most scenes are cards fails instead of shipping.

What the project holds afterwards:

| File | What it is |
| --- | --- |
| `storyboard.json` | One `custom` scene per directed scene, tiling the video, with the director's sound cues as hits. |
| `hyperframes/visual/<scene>.html` | Each scene's fragment: the drawing helpers, the shared props and that scene's code. |
| `.launchclip/storyboard-plan.json` | The director's plan (`visual_explainer`) and every call with its cost. |

`MAKE.json` records it under `visual_explainer`: how many scenes were
directed, drawn and redrawn, how many are cards, and how long the director
and the scenes took.

Limits, today:

- The scenes have a HyperFrames form only, so the run renders with
  HyperFrames. `--renderer remotion` keeps the character-led explainer.
- `--speed draft` and its `--refine` still plan the character-led draft.
- The opening candidates and the critic's repair rounds are skipped: both
  change a storyboard of kit modules, and these scenes are drawn code.
- A style you chose (`--style`) or a brand in the assets keeps its own plan.
  The visual explainer is the default on make's seeded style.

`--explainer characters` plans the earlier default: a small cast carries the
idea.

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

A character story is a Short: with no `--aspect` it comes out 9:16. Pass
`--aspect 16:9` (or `1:1`), or name the shape in the prompt ("a landscape
cartoon", "16:9", "widescreen"), for another one. Every other video still
defaults to 16:9.

It writes a script with speakers, voices it, designs the cast and the
world, plans the shots with that cast, renders an animatic and has it
reviewed, retakes the shots the review fails, then renders the video and
has the critic look at it. The stages are in
[ANIMATION_PIPELINE_RFC.md](../ANIMATION_PIPELINE_RFC.md).

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

A story can only show what LaunchClip can draw, so the writers are given the
list: the worlds (a racetrack, a stable yard and a paddock among them), the
sets, the character kinds and the story props (a starting gate that opens, a
bucket, a hay bale, a saddle, a rosette, a winning post, a jump, a sign, a
trophy, a ball, a gift and a few more). The script names what it turns on
(`shows` in `SCRIPT.json`). If it turns on something that is not on the
list, the script check fails with `undrawable` and the repair call moves the
story to the nearest thing that is, or leaves the thing to the narrator's
words. `MAKE.json` says which under `script.shows`, and warns when a thing
is only told. The props go into the show bible (`world.props`), stand in
every shot, and a change the script plays in a silent line ("The gate
opens.") happens at that line. `finish` fails with a `bible check failed`
message if a prop the story turns on is in no shot.

Under Kokoro each character speaks in a voice of its own, which the show
bible then keeps; with ElevenLabs the narrator's voice reads every line
until you give the characters voice ids (`launchclip cast edit <id> --voice
<voice id>`, then `launchclip bible freeze`). Run the same command again and
the script and the take are reused: no model call, no new take.

### The show bible, and stopping to look at it

After the voice, one model call designs the cast and the world, and
`BIBLE.json` is frozen:

- **The cast.** For each character of the script the model answers with the
  same set paths `launchclip cast create --set` takes
  (`hair.style=bob`, `outfit.top=hoodie`), so it can only choose what the
  rig can draw; an option the rig lacks is left out and named in a warning.
  It is told to keep people cute, relatable and simply dressed, and easy to
  tell apart. A new character is saved to `cast/<id>.character.json`. A
  character whose id is a starter's (`maya`, `sam`) is that starter, with
  the model's changes. A character you saved under the script's id
  beforehand is used as it is.
- **The drawing style** is `chibi`, unless your style pack sets
  `cast.drawing_style` or the prompt asks for another style.
- **Voices.** Each character keeps the voice the script was voiced in.
- **The world**: a kind of place, a time of day, the sets the story plays
  on, and up to three continuity rules.
- **A reference sheet** per character in `bible/sheets/<id>.png` (drawn in
  Chromium, like `launchclip cast sheet`). The browser is the first one
  found of: `LAUNCHCLIP_CHROMIUM`, Playwright's own Chromium, a system
  Chrome, then the headless shell a renderer already installed (Remotion's,
  then HyperFrames'), so a machine that can render can draw its sheets. If
  there is none, the error lists every place it looked.

The shots are then planned with the bible pinned: `storyboard.json` and
`DIRECTION.json` name it (`"bible": {"file", "hash"}`), the story's cast is
copied from it after every model pass, and the cast check runs inside the
plan, so a pose that reaches off the frame is repaired before the render.
`--replan` plans new shots; it never designs a new cast.

A story planned with a bible gets three things without the planner asking:

- **Captions clear of the cast.** White outlined lines with no band or
  plate, in sentence case and the brand's body typeface, up to four words a
  line, with the spoken word in the brand colour. They sit where no character reaches in any cast scene
  (above the cast in most 9:16 stories), in one place for the whole story.
  The style's own caption preset is made for cards and footage and is not
  used; a style sets one for character stories with
  `captions.lanes.characters`. Captions the storyboard places itself
  (`position`) stay where it puts them.
- **A camera that moves inside each shot.** A slow push-in on a character
  who speaks, a gentle drift across a `wide` shot, a punch-in on a
  character who only listens. Each is slow, fast, slow with no overshoot and
  runs for as long as the shot is up. A scene's own `zooms` replace its
  move; `"camera": {"moves": false}` turns them all off.
- **A style gate that measures what the style governs.** The bible fixes
  the world and the cast, so the render's colours are sky, grass and coats,
  not the style's palette. The gate checks the colours the storyboard sets
  itself (captions, brand frame, cards) against the brand colours, and a
  caption preset with a band or a plate over the cast fails it.

To look before any shot is planned:

```bash
launchclip make "<prompt>" --animation --out ./short --stop-after bible   # ends awaiting-approval
launchclip bible show ./short                                             # and look at ./short/bible/sheets
launchclip make "<prompt>" --animation --out ./short --approve bible      # goes on; nothing earlier runs again
```

`MAKE.json` ends `status: "awaiting-approval"` with `stopped.after:
"bible"`, and `next_steps` says the same. In a terminal, make asks at that
point without the flag; with no terminal it goes on unless you pass
`--stop-after bible`. An approval is of that bible: change the bible and it
is asked again.

To change a character before you approve: `launchclip cast edit <id>
--instruction "…" --project ./short`, then `launchclip bible freeze ./short
--characters <id>,<id> --force`. A frozen `BIBLE.json` that make did not
write is always used as it is (make designs a cast only when there is
none), so you can also bring your own: design the characters, freeze the
bible, then run make.

### The animatic, its review and retakes

Before the delivery render, make renders the whole story at draft quality
to `renders/animatic.mp4` and writes `ANIMATIC.json` (its shots, its gates
and the hashes of the storyboard and the bible). This is `launchclip finish
--animatic`; nothing about it is special to make.

With a model that takes images, a **staging review** then looks at the
animatic for story, staging and acting only, with each character's
reference sheet beside the frames (`qa/animatic-critic.json`). While it
does not say `ship`, make **retakes** the shots its blocking and major
findings name: one small model call redirects those shots (their cues,
framing or set; the timing is locked), only those shots render again, and
the review looks again. A round that does not lower the findings is undone
and the rounds stop. The rounds are in `qa/animatic-retakes.json`.

Then the video is rendered. At draft quality (the default) it is the
animatic's cut, so no shot renders twice; `--quality high` renders it
again for delivery. The critic reviews the video as it does for any other
kind, and on this path its repair rounds are retakes too
(`qa/retakes.json`).

`--critic-repairs` (3 by default, 0 for none) is one budget for both: a
round spent on the animatic is not spent again on the video.

| The run ends | When | Exit code |
| --- | --- | --- |
| `ready` | every gate passed and the critic said `ship` | 0 |
| `needs-repair` | a gate failed, or the critic still does not say `ship` once the rounds are spent. The video is rendered, not finished | 2 |
| `awaiting-approval` | it stopped after the bible, the storyboard (`--stop-after storyboard`) or the animatic | 3 |
| `ready-for-review` | no model could look at it (no vision model, or `--no-critic`) | 4 |
| `failed` | a stage failed | 1 |

To watch the animatic before the delivery render:

```bash
launchclip make "<prompt>" --animation --out ./short --stop-after animatic   # ends awaiting-approval, exit 3
open ./short/renders/animatic.mp4                                            # the review is ./short/qa/animatic-critic.json
launchclip make "<prompt>" --animation --out ./short --approve animatic      # renders the video; nothing earlier runs again
```

In a terminal make asks at that point without the flag; with no terminal
it goes on unless you pass `--stop-after animatic`. A headless run goes on
even when the review still asks for a repair: the video is rendered, the
critic has the last word, and the run ends `needs-repair` if it agrees. An
approval is of that storyboard's animatic: change a shot and it is asked
again. `--approve bible,animatic` approves both.

To change a shot yourself before you approve, edit its scene in
`storyboard.json` (or run `launchclip finish ./short --animatic --retake`)
and run the same make command again: the animatic renders only what
changed.

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

### Clips your asset provider fetched

An `--asset-provider-cmd` may answer a shot request with a file it has just
written into the same folder you pass as `--assets`. make copies that file to
`assets/shots/` in the project and records it, by its content, with the
request it answered and the provider's notes
(`.launchclip/provided-files.json`).

When the project runs again, as a rerun or with `--replan`, make finds those
files in `--assets` and knows where they came from:

- No model describes them, at any `--asset-descriptions` setting. Their
  `ASSETS.json` entry carries the provider's description and the request
  ("Fetched by the asset provider for …") under `notes`, and
  `provided: {src, shows}`.
- They are not routed as your media. They are never the base recording, a
  voiceover or footage offered to the planner, and they do not change the
  brief, so the concept, the story, the script and the voice are reused.
  `MAKE.json` lists them in `routing.provided` and counts them in
  `assets.provided`. The planner asks the provider again for the shots the
  new plan wants, so `shots` still says where each one came from.
- A file you add to the folder yourself is described and offered as before.

The match is by content, so a clip is recognised under any name. A file the
provider wrote there before the first run (a pool your app resolved up front)
has no record and is your media, as it always was.

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
  PLAYER-MANIFEST.json     with --stop-after storyboard: the files a browser player needs
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

## What runs at the same time

`make` runs work side by side where one piece does not need another's
result. The video, the files in the project and the progress lines are the
same as when everything runs one at a time; only the wall time changes.

One setting limits model calls: `--model-concurrency <n>` (default 4), or
`LAUNCHCLIP_MODEL_CONCURRENCY`. Every model call of the run goes through
that one limit, whichever stage sends it. Lower it if your provider's rate
limit is tight; `1` sends one call at a time.

What overlaps today:

- **Asset descriptions.** Each image and clip in `--assets` is described by
  its own call, several at once.
- **Candidates.** The planner's opening is rendered while the second opening
  is designed, and the two candidates of a comparison render side by side
  when the machine has room for two renders.
- **Reference sheets** (`--animation`). The show bible's sheets are drawn
  side by side, four at most.
- **Long-form direction and copy.** The chunks were already directed several
  at a time; they now share the one limit.
- **Source page recordings** (`--research`) were already recorded while the
  script is written and voiced.

A fast draft (`--speed draft`) overlaps more: the sentence takes are
voiced while the script is still streaming, the direction call runs beside
the rule-made plan, and every shot request is open at once.

Most of a short video's writing is a chain, and a chain cannot overlap: the
judge needs the five concepts (they come from one call), the story needs the
winner, the script needs the story, the voice needs the script, and the
direction map and the storyboard need the voice's word timings. Those calls
still run one after another.

Side-by-side renders stay inside the render budget: `--concurrency` when you
pass it, otherwise the tabs one render may open on this machine. With room
for one, they run one at a time. `--concurrency` itself means what it did.

If the provider answers a call with a rate limit (HTTP 429), the stage does
not fail. Every call waits for the provider's `Retry-After` (or 2 s, then
4 s, doubling up to a minute), the limit drops by one for the rest of the
run, and the call is sent again, up to five times.

`MAKE.json` keeps one wall time per stage in `timings`, as before, and says
how the calls ran in `model_calls`:

```json
"model_calls": {
  "concurrency": 4,
  "calls": 19,
  "peak": 4,
  "overlapped": 7,
  "stages": {
    "inventory": { "calls": 7, "call_seconds": 41.3, "peak": 4, "overlapped": 7 },
    "prepare": { "calls": 5, "call_seconds": 148.2, "peak": 1, "overlapped": 0 },
    "candidates": { "calls": 3, "call_seconds": 52.0, "peak": 1, "overlapped": 0, "side_by_side": ["candidate stills: 2 at a time"] }
  }
}
```

`call_seconds` adds up each call's own time, so a stage whose calls
overlapped shows more `call_seconds` than its wall time in `timings`.
`peak` is the most calls open at once and `overlapped` how many ran beside
another. After a rate limit, `rate_limit` records the waits.

## Cost

- Every paid call is announced before it is made (`model: PAID call to …`),
  and `MAKE.json` records each call's tokens and estimated cost.
- Each command stops starting paid calls once it has spent $50. Change the
  limit with `--max-cost-usd <amount>` or `LAUNCHCLIP_MAX_COST_USD`, or pass
  `none` to remove it. Calls already running finish, and a rerun starts a new
  $50 budget. Overlapping calls cannot take a run past the limit: a call
  starts beside others only when the most they can all cost still fits under
  it, and otherwise waits its turn. The last call of a run can still pass
  the limit by its own cost, as it could before.
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
