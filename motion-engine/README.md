# motion-engine

Event-timeline motion graphics over real footage. This package is the lab for the renderer that will move into product-videogen's `packages/video-engine` — keep it dependency-light and framework-boundaries clean:

- `schema.js` / `heuristics.js` — pure JS, no React, no Remotion. The `motion.timeline.v1` contract any director (human, heuristic, LLM) must emit.
- `camera.js`, `MotionLayer.jsx`, `components/` — Remotion rendering of a timeline.

## Principles (learned from the scene-template renderer this replaces)

1. **Real media or nothing.** The base layer is footage. This engine never draws fake people, fake terminals, or fake thumbnails.
2. **Everything lands on a spoken word.** Events snap to word boundaries (`snapEventsToWords`); captions render per-word on Whisper/ElevenLabs timings.
3. **No linear interpolation.** Every move is a spring in and a spring out.
4. **Every event makes a sound.** SFX are bound to event types (`DEFAULT_SFX`), ducked under voiceover.
5. **One focal element at a time.** Density caps are enforced in the schema, not the prompt.

## Structure

The visual base is a **scene track** (`scenes[]`): talking_head, screen, console, steps, flow — voice continuous, vision cutting every 2–5s. Events overlay scenes. See [ART_DIRECTION.md](ART_DIRECTION.md) for the full grammar, layout, color, motion, and sound rules; the schema enforces the hard ones (scene length caps, footage-requires-src, zoom-near-cut warnings).

## Event types (v1)

| type | params | feel |
|---|---|---|
| `punch_zoom` | scale, origin_x/y | whole-canvas camera punch with spring in/out |
| `logo_pop` | src, x, y, size, label | asset card pops in with overshoot + motion-blur trail |

Captions are a track derived from `words[]` (with per-word `emphasis`), not events.

## Workflow

```bash
node scripts/make-placeholder-assets.js   # one-time: placeholder SFX + logo marks
npx remotion studio remotion/index.jsx    # open MotionGolden — the golden timeline

# Talking-head loop:
launchclip script <workspace>                       # teleprompter to read on camera
launchclip align <workspace> --media take.mp4       # whisper words + heuristic timeline
launchclip motion-render <workspace>                # video/motion.mp4
```

Drop your recording at `public/base/talking-head.mp4` to make the golden timeline ([examples/motion/golden-timeline.json](../examples/motion/golden-timeline.json)) render over real footage; it doubles as the regression fixture (`test/motion.test.js`).

Replace `public/sfx/*.wav` with a real sound pack (the placeholders are synthesized and merely adequate). Keep the same filenames or update `DEFAULT_SFX`.

## Extraction checklist (when this graduates to product-videogen)

- `schema.js` + `heuristics.js` move as-is (no imports beyond each other)
- Components move into `packages/video-engine/src`
- Word timings come from `caption_aligner.py` / ElevenLabs instead of local whisper
- The heuristic director is replaced by the Motion Director LLM pass, validated against this same schema
- The golden timeline JSON comes along as a render regression test
