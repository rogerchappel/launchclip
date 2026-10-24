# Subject effects

<!-- Generated from kit/core/planning-prompt.mjs by scripts/sync-skills.mjs. Do not edit by hand; run `npm run skills:sync`. -->

Effects that use the presenter cut out of a footage-led recording: graphics that sit behind them, a room that moves while they hold still. They need one person in frame and a local matte; everything else in a footage-led story still works without one. Design: `docs/SUBJECT_EFFECTS_RFC.md` in the LaunchClip repo.

## Getting the subject

1. Probe the recording before planning: `launchclip subject probe assets/recording.mp4 --json`. Read `usable` (and `reasons` when it is false), `framing` (close-up, medium or wide) and `headroom`. Plan subject effects only when `usable` is true.
2. Plan the storyboard. Subject effects are timed on the edited timeline like every other scene.
3. Matte the source range each subject scene covers, padded by about 0.5 s: `launchclip subject matte assets/recording.mp4 --range <in>-<out> --project .`. The matte, its framing data and the room plate are filed under `assets/subject/`, and `base.subject` (default `"auto"`) picks them up. With `base.trim` or `base.edl`, map timeline seconds back to source seconds first.
4. `launchclip story validate`, `launchclip layout-check` and `launchclip finish` read the filed mattes. `launchclip make` runs all of this for you.

The models download on first use (`launchclip subject setup` fetches them up front; `launchclip doctor` reports them). Mattes take about 0.2 s a frame at 1080×1920 on an Apple-silicon Mac, so matte only the ranges you use.

## Layers

- `scene.layer: "behind"`: the scene draws behind the presenter, so their head and body cover it. masthead and dolly-zoom are behind by default.
- No layer (front): the scene draws over the presenter, as every footage-led overlay always has.
- `"split"`: for modules that draw on both sides of the presenter (none yet).
- `base.subject: "off"` turns the subject off; `{"mattes": [...]}` lists mattes explicitly (`src`, `in`, `out`, `info`, `plate`).

Both renderers stack the base recording, behind scenes, the cut-out presenter, front scenes, then captions. A punch-in moves (and blurs) the presenter and the room together.

## Rules

- scene.layer: "behind" draws a scene behind the presenter, so their head and body cover it (a word or chart behind them); omit it (front) for everything else. masthead and dolly-zoom are always behind.
- Use at most one or two subject effects in a 30–60 s piece, at least 3 s apart, never two different ones back to back, and together under a third of the runtime.
- masthead needs headroom; dolly-zoom needs a medium or wide shot.
- Never put a front scene over the presenter's face for more than 0.3 s; layout-check fails it.

## Modules

| Module | Layer | Aspects | Moods | Use when the presenter… |
| --- | --- | --- | --- | --- |
| masthead | behind | 9:16, 16:9 | bold, editorial, premium, launch | names the product or the one idea the video is about ("meet X", "this is X", "it's called X"): one word behind the presenter's head |
| dolly-zoom | behind | 9:16, 16:9 | cinematic, dramatic, premium | lands a realisation, reveal or turn ("that's when", "it hit me", "everything changed"): the room moves, the presenter holds |

### masthead (keeps captions, behind the presenter, needs the subject)
Footage-led, behind the presenter: one huge word (a product name or the one idea) rises in letter by letter at the top of the frame, and the presenter's head covers its lower part like a magazine cover. Needs headroom: medium or wide shots.
params:
- word: one word ≤ 12 chars (uppercased)
- kicker: small line above it ≤ 32 (optional)
- color: paper (default)|primary|accent or #hex (≥ 3:1 on brand bg)
- stagger: seconds between letters (0–0.12, default 0.05)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: title

### dolly-zoom (keeps captions, behind the presenter, needs the subject)
Footage-led, behind the presenter: the room pushes in (or falls away) over one eased beat while the presenter holds still, a dolly zoom for a realisation or a turn. Needs a medium or wide shot and the matte's room plate.
params:
- direction: push (default) | pull (starts on a cut, the room falls away)
- scale: 1.12–1.6 (default 1.3)
- move: seconds the zoom takes (1–2.5)
- release: push: seconds to ease back before the scene end (0.3–1, default 0.5)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: move, release

### punch-in (keeps captions)
Footage-led: a spring zoom on the base recording toward a focus point, timed to a word (a camera on the base, not an overlay). Steps punch in, further in or back out on successive words; blur adds a few frames of zoom blur on each move.
params:
- scale: 1.06–1.25 (default 1.12)
- at: seconds from scene start (optional; else a matching hit, else a default)
- focus: {x, y} canvas fractions (default base.focus, else {0.5, 0.42})
- release: seconds before the scene end when the zoom springs back (0.3–2, default min(0.5, 30% of the scene))
- steps: [{at, scale}] 1–4, instead of at/scale: each springs to its scale (1–1.35; the first ≥ 1.06), at least 0.3 s apart
- blur: true (14 px at 1080) or 2–30 px: velocity-shaped zoom blur, 0 once settled (default off)
events: punch, step-<i>, release
