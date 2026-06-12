# Art Direction — motion-engine

The target grade is creator-led product shorts in the Greg Isenberg style: a real person and a real product, cut dense, designed like editorial, sounding tactile. This document is the spec; components implement it. When a render looks wrong, the fix is here first, then in code.

## 1. The structural rule: voice is continuous, vision is not

The voiceover (talking-head audio or TTS) runs unbroken start to finish. The **visual base switches scenes every 2–5 seconds**. The talking head is *one scene type among five* — it is NOT the chassis of the video.

Where the face belongs:
- **Hook (first 1–3s)** — a human opening earns trust and stops the scroll.
- **Credibility beats** — opinions, claims, "here's the thing" moments.
- **CTA (last 2–3s)** — people follow people.

Everything else cuts away to full-screen evidence: the tool actually running, the console actually outputting, the workflow actually drawn. If a sentence describes something visible, the screen must show that thing, not the person saying it.

Scene-length law: **no scene longer than 5 seconds, ever** (schema warns past 5). A 20-second short has 5–8 scenes. If a demo needs longer, split it into multiple scenes with different zoom/crop so it *feels* like a cut.

## 2. Scene vocabulary (v1)

| type | content | role |
|---|---|---|
| `talking_head` | real footage, continuous take, trimmed to the global clock | hook, opinion, CTA |
| `screen` | real screen recording, full-bleed | the tool doing the thing |
| `console` | real captured terminal output, restyled chrome, type-on | CLI proof, "one command" |
| `steps` | numbered cards building in sequence | how-to, listicle beats |
| `flow` | nodes + arrows building in sequence (vertical in 9:16) | pipelines, workflows, before→after |

Rules of content honesty: `screen` and `talking_head` are footage and must be real. `console` renders *captured* output — restyle the chrome, never invent the text. `steps`/`flow` are designed graphics and should look proudly graphic — big type on dark editorial ground, not fake screenshots.

## 3. Cuts and transitions

- Every scene change is a **hard cut + settle**: the incoming scene starts at 106–108% scale and springs to 100% in ~8 frames. No crossfades, no slides, no wipes — they read as template software.
- Every cut fires a **whoosh** (auto-bound, not authored per-scene).
- Punch-zooms (`punch_zoom` events) live *inside* scenes for emphasis words. Never schedule a zoom within 0.5s of a scene boundary — the cut is already the accent.

## 4. Layout and typography

- Canvas 720×1280 design space. Safe margins: 6% sides, 12% top (platform UI), 20% bottom (captions + platform UI).
- **One focal element per moment.** A scene shows the demo OR a step build OR a stat — never a dashboard of widgets. If two things matter, that's two scenes.
- Captions: Inter Black, ~5.2% of height, uppercase, white with dark stroke; emphasis words 12% larger in accent color. Captions sit at 68% height, centered. 1–3 words on screen at a time.
- **Captions only over footage.** During `console`/`steps`/`flow` scenes the caption track goes dark — the scene's own type carries the words. Captions over a graphic scene is a disqualifying collision.
- Graphic scenes (console/steps/flow): type is the design. Headlines ≥ 4.5% of height. Body never below 2.2% — if it's not legible on a phone at arm's length, it doesn't ship.
- Numbers get outsized treatment: step indices, counts, and stats render 2–3× body size.

## 5. Color

- Ground: near-black blue (#0b0e14 → #10141c radial), not pure black.
- Ink: #fafafa. Muted: rgba(255,255,255,0.64).
- Accent (default #ffd60a yellow) is rationed: emphasis caption words, step indices, active flow nodes, the CTA. If accent appears in two places at once, one of them is wrong.
- Success/console green #22c55e reserved for terminal prompts and "it worked" moments.
- Per-brand skinning swaps accent + logo only. Ground, ink, and type scale are the engine's signature and stay fixed.

## 6. Motion

- Springs only. Entrances: damping 11–14, stiffness 220–260 (fast, slight overshoot). Exits: damping 16–18, stiffness 130–180 (quicker settle, no bounce).
- Motion blur (`Trail`) on any element travelling more than ~10% of canvas in under 0.3s.
- Sequenced builds (steps, flow nodes) land **on the spoken word** that names them, not on even intervals.
- Idle is forbidden: any scene older than 1.5s must have something alive — type-on cursor, progress fill, subtle 1.5% drift on screen recordings. Imperceptible drift beats visible stillness.

## 7. 3D depth

Depth sells the grade, but it's seasoning, not structure. v1 is CSS perspective only (no WebGL); `@remotion/three` is the escalation path if we ever need a true product spin.

- **Perspective 1000–1200px** on any container whose children rotate in 3D. Flat rotation without perspective reads as a squash — never ship it.
- **Entrances may be steep, rests must be shallow.** Elements can flip in from up to 75° (logo cards rotateY, step cards rotateX from their top edge) but settle to ≤4° resting tilt. Resting elements may idle-float (±3–4° slow oscillation) — this also satisfies the no-idle rule.
- **Light follows tilt.** Any 3D rotation shifts the element's shadow in the opposite direction; a tilt with a static shadow looks pasted on.
- **Cuts get a breath of depth**: the scene-enter settle may add ≤3° of rotateX falling to 0 alongside the scale settle. Subliminal, not architectural.
- Banned: continuous logo spins, extruded 3D text, elements orbiting the canvas, anything that would feel at home on a DVD screensaver. If the viewer *notices* the 3D, it's too much.

## 8. Sound

Three layers, mixed in this order of priority:
1. **Voice** — full level, always intelligible.
2. **SFX** — whoosh on every cut, pop on every element entrance, tick on caption emphasis (sparingly). −12dB under voice. Placeholders are synthesized; a real pack (e.g. one whoosh family + one pop family, 3–4 variants each to avoid machine-gun repetition) is the single cheapest quality upgrade.
3. **Music** — optional bed at −24dB. Drops out entirely for the final CTA second.

## 9. Pacing template (30s reference cut)

| t | scene | why |
|---|---|---|
| 0–2.5 | talking_head | hook, eye contact |
| 2.5–6 | console or screen | show the claim immediately |
| 6–10 | screen | the demo, zoomed to the action |
| 10–12 | talking_head | re-hook: "but here's the part nobody does" |
| 12–17 | steps | the how, building per word |
| 17–22 | screen | result reveal |
| 22–26 | flow | the system view / before→after |
| 26–30 | talking_head | CTA, face, accent-colored payoff line |

The 10–12s re-hook on the face is deliberate — retention dips there; a human re-grabs it.

## 10. What disqualifies a render

- A scene over 5s, or a talking head sitting behind graphics the whole video
- Any invented "screenshot," fake cursor, or fabricated terminal text
- Caption text smaller than 4.5% height, or two focal elements fighting
- A cut without a sound, an entrance without a spring, accent in two places
- Even-interval builds that ignore the voice
