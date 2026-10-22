# Roadmap

LaunchClip's goal: **a SaaS founder points it at their product and gets a launch-ready video, first time.** This roadmap is ordered by what gets founders there fastest. Dates aren't promised; items move as we learn.

## Shipping now: 0.2.0

- One prompt (plus your assets) to a finished video, through your AI agent's subscription or headless (`launchclip make`)
- No API keys needed: the voice, music, sound effects and rendering are built in and local; ElevenLabs, OpenAI and Anthropic are optional upgrades
- It picks the kind of video from your inputs: a motion-graphics explainer, a product demo, or an edit over your footage
- Style packs, five starter styles, and styles drafted from your previous videos
- A world camera, motion grammars, ambient motion and 14 caption styles
- Raw-footage base edit: silences, bad takes and filler words removed, audio cleaned up
- Self-checking and self-repair before you see the video
- Change it by chatting; only the changed scenes re-render
- Export to Final Cut Pro, Premiere Pro, DaVinci Resolve or OpenTimelineIO
- Published on npm

## Next

### Demo autopilot: it records your product for you

Point LaunchClip at your codebase and it records your product demo itself. No screen recording, no cleaning up your browser, no retakes.

1. **Start your app:** read the repo (package scripts, README, docker-compose, `.env.example`), start the dev server locally, and wait until it's healthy.
2. **Prepare a clean demo state:** run your seed script or fixtures, so the recording shows realistic sample data, never your real customers or credentials.
3. **Plan the journeys:** from your prompt and the code (routes, pages, key components), pick the 2–4 flows that sell the product, e.g. *sign up → create a project → see the result*.
4. **Record them:** drive a real browser with scripted, human-paced interactions in a clean, consistent window, at 1080p or 4K, with smooth cursor movement and natural typing. Each flow becomes its own clip.
5. **Keep a timeline of every action:** each click, keystroke, page change and result is time-stamped. LaunchClip uses those times to zoom in on the click, add a callout as a feature appears, and land a sound effect on each action. The edit is timed to what actually happens in your app.
6. **Edit it in:** the clips flow into the video as product-demo scenes alongside the motion graphics and voiceover, in your style.

Guardrails:
- Runs on your machine against your local or staging app.
- Asks before running anything with side effects.
- Never types real passwords: it uses your seed data or test accounts only.
- Redacts anything that looks like a secret.
- Every recorded flow is shown to you before it's used.

### Also next

- **Smarter asset understanding:** recognise what's in your screenshots and recordings (a pricing page, a dashboard, an onboarding flow) and place them where the story needs them.
- **Built-in critic by default:** a vision model reviews the video the way a human editor would, as part of `launchclip make`.
- **Faster first run:** smaller downloads and pre-warmed rendering, so the first video arrives sooner.
- **Windows support:** tested and supported alongside macOS and Linux.

## Later

- **More languages:** voices, captions and on-screen text in multiple languages from one storyboard.
- **Avatar presenters:** a generated presenter for founders who'd rather not be on camera (building on the existing HeyGen avatar support).
- **Launch kits:** one run produces the launch video plus cut-downs for every platform (YouTube, Shorts, Reels, TikTok, X, LinkedIn, Product Hunt), thumbnails and captions files.
- **Brand from your website:** point it at your landing page and it builds your style pack from your real colours, fonts and tone.
- **Scheduled updates:** re-record the demo and refresh the video automatically when your product changes.
- **Partial re-rendering for HyperFrames**, once its renderer supports frame ranges (Remotion already has it).

## Ideas we're exploring

- A cross-model benchmark: how well do different AI models plan videos with LaunchClip?
- A hosted version, for founders who don't use an AI coding agent at all.
- Curated music and sound packs per style.

Have an idea or a need? [Open an issue](https://github.com/rogerchappel/launchclip/issues).
