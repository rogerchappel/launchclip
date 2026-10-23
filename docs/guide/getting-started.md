# Getting started

## What you need

- **Node.js 22 or newer:** [nodejs.org](https://nodejs.org)
- **FFmpeg:** on a Mac, `brew install ffmpeg`; on Ubuntu, `sudo apt install ffmpeg`; on Windows, [ffmpeg.org](https://ffmpeg.org/download.html)
- **An AI coding agent you already use:** Claude Code or Codex (Codex works on a ChatGPT plan). Or skip the agent and use your own API keys with the [headless CLI](headless.md).

Everything else (the renderer's browser, the offline voice model, fonts) downloads automatically the first time it's needed. That makes the very first video slower, roughly 10–15 minutes on a typical connection; after that, videos start straight away.

## Install

```bash
npm install --global github:rogerchappel/launchclip
launchclip doctor
```

`launchclip doctor` checks your setup and tells you exactly what's missing. It never prints secrets.

## Add LaunchClip to your AI agent

```bash
launchclip skills install --agent claude    # Claude Code
launchclip skills install --agent codex     # Codex
```

This adds the LaunchClip skills to your agent. It's safe to run again; it won't overwrite anything that isn't LaunchClip's. (Claude Code needs version 2.1.203 or newer.)

## Make your first video

Put whatever you have in a folder (a logo, a product demo recording, screenshots, a talking-head clip, a voiceover, some notes), then open your agent in that folder and ask:

- **Claude Code:** `/launchclip-create-video-remotion Make a 60-second landscape launch video for my product using the files in ./assets`
- **Codex:** `$launchclip-create-video-remotion Make a 60-second landscape launch video for my product using the files in ./assets`

Your agent plans the story, writes and voices the script, designs every scene, scores it, renders it, checks its own work, fixes what it finds, and hands you the finished video. Ask for changes in plain words:

> "Make the intro punchier." · "Use the warm-documentary style." · "Cut it to 30 seconds for Shorts."

Only the changed scenes re-render.

## It's free to run

With the skill, **your existing AI subscription does the creative work**, so there's no extra AI bill. The voice, music, sound effects and rendering all run on your machine. Add an `ELEVENLABS_API_KEY` later if you want premium voices, composed music or your own sound-effect library. See [Voice, music and sound effects](sound.md).

## Prefer to install from source?

```bash
git clone https://github.com/rogerchappel/launchclip.git
cd launchclip
npm ci
npm link
launchclip doctor
```

## Licensing

LaunchClip itself is MIT-licensed. It renders with open-source and source-available tools that have their own terms. In particular, Remotion's licence is free for individuals, non-profits and companies with up to three employees; larger for-profit companies need a Remotion company licence. Read [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) before commercial use.
