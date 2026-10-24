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
- `"split"`: modules that draw on both sides of the presenter (feed-frame: its backdrop behind them, its feed chrome in front).
- `base.subject: "off"` turns the subject off; `{"mattes": [...]}` lists mattes explicitly (`src`, `in`, `out`, `info`, `plate`).

Both renderers stack the base recording, behind scenes, the cut-out presenter, front scenes, then captions. A punch-in moves (and blurs) the presenter and the room together.

## Rules

- scene.layer: "behind" draws a scene behind the presenter, so their head and body cover it (a word or chart behind them); omit it (front) for everything else. masthead and dolly-zoom are always behind.
- Use at most one or two subject effects in a 30–60 s piece, at least 3 s apart, never two different ones back to back, and together under a third of the runtime.
- masthead and app-stage need headroom; dolly-zoom needs a medium or wide shot.
- app-stage, phone-stage and a backdrop-swap backdrop show real product media from the asset inventory (screenshots, screen recordings, demo flows); never invent a screenshot. feed-frame shows counts only when the brief gives them.
- A checklist without a rect places itself beside the presenter (above the head, else on the chest) at a legible size; keep it to two or three short rows on a close shot.
- Never put a front scene over the presenter's face for more than 0.3 s; layout-check fails it.

## Modules

| Module | Layer | Needs the matte | Aspects | Moods | Use when the presenter… |
| --- | --- | --- | --- | --- | --- |
| masthead | behind | yes | 9:16, 16:9 | bold, editorial, premium, launch | names the product or the one idea the video is about ("meet X", "this is X", "it's called X"): one word behind the presenter's head |
| dolly-zoom | behind | yes | 9:16, 16:9 | cinematic, dramatic, premium | lands a realisation, reveal or turn ("that's when", "it hit me", "everything changed"): the room moves, the presenter holds |
| feed-frame | split | yes | 9:16 | bold, launch, playful | talks about posting, going viral or "this exact video": the frame becomes a feed window they break out of |
| pull-back | front | no | 9:16, 16:9 | launch, editorial | reveals how the video or result was made, or a process finishing ("made with", "it transcribes, cuts…"): the frame pulls back into an app window while real steps tick |
| backdrop-swap | behind | yes | 9:16, 16:9 | launch, premium, bold | turns from the problem to the product ("so we built", "that's why", "enter"): the room gives way to a brand backdrop |
| app-stage | behind | yes | 9:16, 16:9 | launch, editorial | shows or describes the product on screen ("here's the dashboard", "this is the app"), with a screenshot or recording in the assets: the UI fills the top, their head over its edge |
| phone-stage | front | no | 9:16, 16:9 | launch, playful | shows the product on a phone or a mobile flow, with a recording or screenshot in the assets (a demo-autopilot flow fits) |
| growth-line | behind | yes | 9:16, 16:9 | bold, launch, editorial | gives a growth result ("doubled", "took off in week three"): a line kicks up behind their head |
| glass-word | behind | yes | 9:16, 16:9 | premium, cinematic | names the one idea or the brand in a premium or tech piece: one glass word on the wall behind their head |
| orbit-cards | split | yes | 9:16, 16:9 | bold, playful | lists many things or shows social proof ("all these tools", "people keep telling me"), with real items in the assets or brief: cards circle them |

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

### feed-frame (hides captions, needs the subject)
Footage-led: the recording springs into a portrait feed window on a dark backdrop and the presenter breaks out over its top and sides, with generic feed chrome (icons, the user's handle, a caption, a progress bar). For "this exact video", posting or going viral. Counts appear only when given. Hides captions.
params:
- handle: @handle ≤ 24 (optional; shows the avatar row)
- caption: one line ≤ 60 (optional)
- counts: {likes?, comments?, shares?} strings ≤ 8 the user supplied (optional; never invent them)
- follow: boolean (default true with a handle)
- scale: window size 0.55–0.85 of the frame
- release: seconds to spring back (0.3–1)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: frame, chrome, release

### pull-back (hides captions)
Footage-led: the recording shrinks into an app window while real steps tick off beside it and a progress bar counts to 100%. For "and this video was made by…", a process finishing, or a product reveal. Hides captions.
params:
- steps: 1–4 real steps ≤ 28 chars each (required)
- title: window title ≤ 32 (e.g. a file or product name)
- label: progress label ≤ 20 (default "Rendering")
- scale: window size 0.4–0.75
- release: seconds to spring back (0.3–1.2)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: pull, step-<i>, done

### backdrop-swap (keeps captions, behind the presenter, needs the subject)
Footage-led, behind the presenter: the room dissolves into a backdrop (brand gradient, or a supplied product screenshot or video) and the presenter glides down in front of it; an optional title sits above their head. For the turn from the problem to the product.
params:
- backdrop: {src: assets/ image or video (a demo-autopilot flow: assets/demo/<flow>.mp4), sourceStart?: seconds (video), fit?: cover|contain} (default: a brand gradient)
- title: ≤ 32 (optional)
- scale: presenter size 0.6–0.95 (default 0.78)
- release: seconds to glide back (0.3–1)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: swap, release

### app-stage (keeps captions, behind the presenter, needs the subject)
Footage-led, behind the presenter: the product UI (a screenshot or recording) slides down to fill the top of the frame and the presenter's head rises over its bottom edge. Needs headroom; for showing the app while talking about it.
params:
- media: {src: assets/ image or video (a demo-autopilot flow: assets/demo/<flow>.mp4), sourceStart?: seconds (video), fit?: cover|contain} (required)
- title: app or page title ≤ 32 (optional)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: stage

### phone-stage (keeps captions)
Footage-led: a phone springs in beside the presenter's head and plays a real screen recording or screenshot (a demo-autopilot flow fits), floating gently while the room pans away from it. For showing the app on a phone while explaining it.
params:
- media: {src: assets/ image or video (a demo-autopilot flow: assets/demo/<flow>.mp4), sourceStart?: seconds (video), fit?: cover|contain} (required)
- side: auto|left|right (default: the side with more room)
- pan: boolean: pan the room away (default true)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: phone

### growth-line (keeps captions, behind the presenter, needs the subject)
Footage-led, behind the presenter: a line chart draws itself across the top of the frame behind their head and kicks up at the take-off point into a glowing spike with a labelled pill. For growth results ("doubled", "took off in week three"). Illustration by default; real figures need a source.
params:
- points: [{value, label? ≤ 6}] 3–10 (the shape; labels sit along the top)
- mode: illustration (default) | data (needs source)
- source: ≤ 48, required for data
- takeoff: index of the point the spike starts from (default: before the biggest rise)
- pill: label ≤ 16 above the end, e.g. "Scale" (optional)
- draw: seconds the line takes (0.8–3)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: draw, takeoff, pill

### glass-word (keeps captions, behind the presenter, needs the subject)
Footage-led, behind the presenter: one big word of extruded clear glass stands on the wall at head height, turned in perspective, and a light sweeps across it; the head covers the middle letters. For naming the one idea or a brand in a premium, tech look.
params:
- word: one word ≤ 10 (uppercased)
- tint: clear (default) | primary | accent
- turn: degrees the word turns away (−35–35, default −18)
- sweep: boolean (default true)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: reveal, sweep

### orbit-cards (keeps captions, needs the subject)
Footage-led, around the presenter: 3–6 real items (screenshots, posts, logos, quotes the user supplied) on cards whip in and circle the presenter's chest, passing behind them on the far side and in front on the near. For social proof or "all these tools". Never invent items.
params:
- items: [{image?: assets/ image, text?: ≤ 40}] 3–6, each real
- speed: degrees per second (8–60, default 26)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: orbit

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
