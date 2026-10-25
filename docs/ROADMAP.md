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
- **Demo autopilot:** point it at your SaaS codebase and it starts the app, records the key flows on safe demo data, and edits them in with zooms and callouts timed to every action ([guide](guide/demo-autopilot.md))
- **Subject-aware effects:** in a talking-head recording, graphics can sit behind you (your product name behind your head, your app on the wall behind you, a dolly zoom), chosen by the art director like any other module, or put on a clip yourself with `launchclip fx` ([guide](guide/effects.md))
- Published on npm

## Next

- **Videos that look designed, not decorated** ([RFC](VIDEO_QUALITY_RFC.md)):
  - Pacing and density are measured from strong reference videos, per format: Shorts, long form, your own footage and motion graphics.
  - Every line of the story gets a visual decision, and footage gets split-screen layouts and a much larger visual vocabulary.
  - Styles carry your brand frame and a few simple dials, and a draft that's sparse or off-style fails its checks before you see it.
- **Smarter asset understanding:** recognise what's in your screenshots and recordings (a pricing page, a dashboard, an onboarding flow) and place them where the story needs them.
- **Built-in critic by default:** a vision model reviews the video the way a human editor would, as part of `launchclip make`.
- **Faster first run:** smaller downloads and pre-warmed rendering, so the first video arrives sooner.
- **Windows support:** tested and supported alongside macOS and Linux.

## Later

- **More languages:** voices, captions and on-screen text in multiple languages from one storyboard.
- **Avatar presenters:** a generated presenter for founders who'd rather not be on camera (building on the existing HeyGen avatar support).
- **Animated characters:** a built-in cast for explainers and story-led promos ("someone hits the problem, then your product fixes it"), drawn in code so a character looks the same in every shot. One rig, many people: each character is a mix of build, skin tone, hair, outfit and accessories, with a few dozen ready-made, coloured by your style pack and checked on a cast sheet. The planner directs them with named poses and expressions cued to the narration, in a handful of drawing styles and in sets that fit a product story (a desk and laptop, a phone, a screen showing your own app). It works with both renderers.
- **Launch kits:** one run produces the launch video plus cut-downs for every platform (YouTube, Shorts, Reels, TikTok, X, LinkedIn, Product Hunt), thumbnails and captions files.
- **Brand from your website:** point it at your landing page and it builds your style pack from your real colours, fonts and tone.
- **Scheduled updates:** re-record the demo and refresh the video automatically when your product changes.
- **Partial re-rendering for HyperFrames**, once its renderer supports frame ranges (Remotion already has it).

## Ideas we're exploring

- A cross-model benchmark: how well do different AI models plan videos with LaunchClip?
- A hosted version, for founders who don't use an AI coding agent at all.
- Curated music and sound packs per style.

Have an idea or a need? [Open an issue](https://github.com/rogerchappel/launchclip/issues).
