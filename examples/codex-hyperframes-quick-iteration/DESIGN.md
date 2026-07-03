# Codex HyperFrames Shorts Cut

## Style Prompt

A cinematic vertical technical explainer for founder-engineers: precise, editorial, and code-native, but with the continuity and acceleration of a short film rather than a slide deck. The frame should feel like a moving review room where Codex, HyperFrames, SFX, captions, and validation commands are visible artifacts. Transitions should feel like focus pulls, velocity ramps, and camera passes through the composition.

## Colors

- Background: `#0d1110` graphite black, never pure black.
- Foreground: `#f1ead8` warm off-white for primary text.
- Muted text: `#9aa49d` green-tinted slate for secondary context.
- Primary accent: `#c7f44f` acid chartreuse for action, progress, and final-state signals.
- Warm detail: `#d9a85f` amber for code prompts and small warnings.

## Typography

- Display and body: `Space Grotesk`, weights 300, 600, and 700.
- Code, labels, and command snippets: `IBM Plex Mono`, weights 400 and 600.

## Motion Rules

- Format is 9:16, 1080x1920, YouTube Shorts safe.
- Use focus blur, scale, and y-axis velocity to carry viewers between scenes.
- Avoid hard scene-card swaps; the outgoing frame should smear into the next frame.
- Captions sit lower-middle and move with short cinematic blur, not social bounce.
- SFX support motion beats: riser, whoosh, impact.

## Voiceover Direction

Use ElevenLabs text-to-speech when `ELEVENLABS_API_KEY` is available. Voice should be calm, cinematic, technical, and lightly urgent.

Script:

Codex is not just writing a page. It is writing motion. Start with the Short: lock the format, the voice, and the hero frames. Build the static frame first, then let GSAP move into it. Use HyperFrames checks as the editor: lint, inspect, render. The trick is to shrink the tail end. Stop chasing taste. Fix the visible misses, render again, and ship the first usable cut.

## What NOT To Do

- Do not use purple-blue gradients, cyan neon, or generic AI dashboard styling.
- Do not center every scene; use edge anchors, panels, and scan paths.
- Do not use pure `#000` or `#fff`.
- Do not create identical card grids; each scene needs a distinct composition.
- Do not hide the workflow behind abstraction: show actual commands, checks, and review loop language.
- Do not use slideshow-style pushes as the primary transition language.
