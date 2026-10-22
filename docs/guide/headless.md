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
| `--duration` | from the prompt, else 30 | Target length in seconds. The video is sized to the real narration. |
| `--voice` | `kokoro` | `elevenlabs` is paid. |
| `--music` | finish's default | `synth` (free), `elevenlabs` (paid) or `none`. |
| `--renderer` | `remotion` | Or `hyperframes`. |
| `--quality` | `draft` | `high` renders `renders/final.mp4`. |
| `--out <dir>` | `./launchclip-<slug>/` | The project folder. |
| `--replan` | off | Plan a new storyboard on a rerun. |
| `--no-critic` | critic on with OpenAI models | Skip the automatic visual review. |

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
3. **Writes the script** (motion videos only), sized to your duration, and
   records the voice.
4. **Plans the storyboard** from a tested module library. LaunchClip checks it
   (layout, timing, only your real files) and sends errors back to the model
   for up to four repairs.
5. **Finishes the video:** captions, music and sound effects, rendering,
   mastering to −14 LUFS, and quality gates.
6. **Reviews the frames** with the model when it can see images (OpenAI), and
   writes `qa/critic.json`.

## Record your product with `--repo`

Point `make` at your app's codebase and it records the product demo first, with [demo autopilot](demo-autopilot.md):

```bash
launchclip make "A 45-second launch video for Pulseboard" --repo ~/code/pulseboard
```

Before the script, make starts your app, seeds it, plans 2–4 flows with the same model, records each one into `<project>/assets/demo`, and stops the app. The approved flows reach the script and the storyboard as product-demo clips, each with its params built from its action log, so the zooms, outlines and sound effects land on what really happened in your app.

- **It asks first.** In a terminal, make lists the seed and start commands and waits for a yes, then lists the recorded flows' contact sheets and asks before using them. With no terminal (CI, a script), pass `--approve-demo` to agree to both up front. Without it, make stops after recording, with the review as its next step. Run `launchclip demo approve <project>/assets/demo` and re-run make, which reuses the recording.
- **Same guardrails as `demo record`:** local or staging URLs only (`--allow-host <host>` to opt in), seed data or `LAUNCHCLIP_DEMO_*` test accounts only, and secrets redacted.
- `--demo-plan DEMO-PLAN.json` records your own plan instead of a planned one. `--start` and `--url` override detection, and `--redemo` records again.

## Where the output lands

```
launchclip-<slug>/
  renders/draft.mp4        the video (renders/final.mp4 with --quality high)
  MAKE.json                routing and reasons, models, costs, timings, gate results
  storyboard.json          the plan; edit it and run `launchclip finish` to iterate
  SCRIPT.json, NARRATION.json, ASSETS.json, BRIEF.md
  qa/                      contact sheets, evidence, gate reports, critic.json
```

The command prints a short summary with the gate results and the next steps.
A failed stage says what to fix. Run the same command again to resume: the
script, storyboard, voice, music and rendered segments are reused.

## Cost

- Every paid call is announced before it is made (`model: PAID call to …`),
  and `MAKE.json` records each call's tokens and estimated cost.
- With `gpt-5.6-luna`, one run costs roughly $0.05–0.15 of model time: one
  script pass, maybe one resize, one storyboard pass plus up to four repairs
  (about $0.015 each), and one critic pass over the contact sheets ($0.02–0.04).
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
