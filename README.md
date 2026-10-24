# LaunchClip

**Describe your video. Drop in your stuff. Get the finished video.**

LaunchClip turns one prompt, plus whatever you have (a logo, a product demo, screenshots, a talking-head clip, a voiceover), into a fully edited, designed, scored and captioned video. Not a draft or a timeline: a video you can post.

Built for founders launching a product, and anyone who'd rather ship than spend a week in an editor.

<!-- Launch video: replace this comment with the embedded video or a link once it's published. -->
> 🎬 **Watch the launch video:** *coming soon*

---

## Why people use it

- **One prompt → a finished video.** Story, script, voiceover, motion graphics, camera moves, captions, music, sound effects and the final mix are all handled.
- **It decides what to make.** Give it a talking head and it edits around you. Give it a product demo and it builds the walkthrough. Give it just an idea and it makes a full motion-graphics explainer. Landscape or portrait, from a 15-second Short to a couple of minutes.
- **It looks like you.** Pick a style, or point it at your previous videos to match them, and every video stays on brand.
- **It fixes its own work.** Before you see anything, it checks the render (layout, timing, motion, audio, legibility) and repairs what it finds.
- **Change it by chatting.** *"Make the intro punchier."* Only the changed part re-renders.
- **Raw footage? The base edit is done.** Silences, bad takes and filler words are removed, and the audio is cleaned up. Great for podcasts and talking heads.

## No API keys needed

LaunchClip works with **the AI subscription you already pay for.** Install the skill into **Claude Code** or **Codex** (Codex works on a ChatGPT plan), and your agent does the creative work. The voice, music, sound effects and rendering all run on your machine, so there's no extra AI bill.

Want more? Add an ElevenLabs key for premium voices, composed music and your own sound-effect library. Prefer automation? Run it headless with your own ElevenLabs, OpenAI or Anthropic keys.

## Quick start

You need [Node.js 22+](https://nodejs.org) and FFmpeg (`brew install ffmpeg` on a Mac).

**1. Install**

```bash
npm install --global github:rogerchappel/launchclip
launchclip doctor
```

**2. Add it to your AI agent**

```bash
launchclip skills install --agent claude    # or: --agent codex
```

**3. Ask for a video.** Put your files in a folder, open your agent there, and type:

```text
/launchclip-create-video-remotion Make a 60-second landscape launch video for my product using the files in ./assets
```

(In Codex, start with `$launchclip-create-video-remotion` instead.)

That's it. Your agent writes it, voices it, designs it, scores it, renders it, checks it and hands you the video.

## What to ask for

> A 90-second launch video for my SaaS using my logo and demo recording. End on "Start your free trial."

> Turn `demo.mp4` into a 45-second portrait product demo for Shorts, with zooms on the key clicks.

> Clean up my podcast recording, then cut a 45-second highlight with captions.

> Make a style from my last three videos and use it for this one.

More in [Example prompts](docs/guide/prompts.md).

## Make it yours

Start from a built-in style (`editorial-dark`, `bold-creator`, `minimal-tech`, `warm-documentary` or `neon-explainer`), match your previous videos, or write your own: colours, fonts, how things move, camera behaviour, 14 caption styles, and how busy the sound is. It can be a full motion-graphics piece or a minimal edit that keeps your footage up front. See [Make it look like you](docs/guide/styles.md).

## Headless, from the command line

No agent needed. One command, your own API keys:

```bash
launchclip make "A 60-second launch video for Ledgerly, which reconciles Stripe payouts automatically" \
  --assets ./assets --aspect 16:9 --duration 60
```

It sorts your assets, chooses the right kind of video, writes and voices the script, plans every scene, renders it, checks it and repairs it. See [Headless CLI](docs/guide/headless.md).

## It gets it right more often, every release

Every video passes automatic quality checks: nothing outside the safe zone, text big enough to read on a phone, captions that never collide with graphics, motion that never goes dead, and audio at the right level. When a check fails, LaunchClip repairs the problem and checks again, so you get a finished video rather than a list of problems. Each release lowers the number of repairs needed; the goal is right first time, every time.

## Demo autopilot

Point LaunchClip at your SaaS codebase and it records your product demo for you: it starts your app, uses safe demo data, records the key flows in a real browser, and edits them in with zooms and callouts timed to every click. Ask your agent for *"a launch video with a demo of my app"*, or see [Demo autopilot](docs/guide/demo-autopilot.md).

## Learn more

- [Getting started](docs/guide/getting-started.md): install, agents and your first video
- [Voice, music and sound effects](docs/guide/sound.md): free built-ins and optional upgrades
- [Raw footage](docs/guide/raw-footage.md): the base edit for podcasts and talking heads
- [Effects around you on camera](docs/guide/effects.md): your product name behind your head, your app around you, one effect on a clip with `launchclip fx`
- [Finish in your editor](docs/guide/editors.md): export to Final Cut Pro, Premiere Pro or DaVinci Resolve
- [Roadmap](docs/ROADMAP.md) · [All guides](docs/guide/README.md) · [Advanced reference](docs/guide/advanced.md) · [CLI reference](skills/launchclip-cli/references/cli-reference.md)

## Licence

LaunchClip is MIT-licensed. Its rendering tools have their own terms. Remotion is free for individuals and companies with up to three employees; larger companies need a Remotion company licence. Details are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)
