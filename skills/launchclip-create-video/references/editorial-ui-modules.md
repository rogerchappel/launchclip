# Recorded editorial UI modules

Use the skill-local `scripts/editorial-ui-modules.mjs` helper for a consistent
browser/desktop media window, checklist, step rail, callout, audience grid or
trend chart, formatted metric or progress bar. These are bundled
HTML/CSS/GSAP templates, not installed Radix or Magic UI components. Window
chrome follows LaunchClip's existing `src/hyperframes_assembler.js` treatment;
checkmark geometry comes from its shipped `public/icons/check.svg`.

The helper provides reusable geometry and finite animation fragments; it does
not choose moments, validate facts, measure a real product's progress or approve
creative quality. Choose modules through `recorded-video.md` and keep the same
source and audio contracts.

## Generate a module

Save a module specification in the composition project, then run:

```bash
node <installed-skill>/scripts/editorial-ui-modules.mjs <project>/module.json > <project>/module-fragments.json
```

Use the actual installed skill path. This makes no model or provider calls and
writes no media. Alternatively import `buildEditorialModule(spec)` from the
same script in a local authoring tool.

Example conceptual process (the stages are editorial labels, not measured
completion or a product screenshot):

```json
{
  "id": "build-process",
  "kind": "step-rail",
  "aspect": "16:9",
  "start": 12,
  "duration": 8,
  "rect": {"x": 80, "y": 690, "width": 760, "height": 300},
  "title": "A simple process",
  "accent": "#FF6A00",
  "steps": [
    {"label": "Brief", "at": 0.6},
    {"label": "Build", "at": 2.2},
    {"label": "Check", "at": 4.3},
    {"label": "Share", "at": 6.2}
  ]
}
```

`start` is absolute accepted-timeline seconds. Row/step `at` and checklist `doneAt` values are offsets
from that start; emitted `events` use absolute seconds. Supply a unique DOM-safe
lowercase `id` for each module. The helper rejects unknown fields, invalid
geometry and unsupported inputs rather than silently discarding them.

| Kind | Content fields |
| --- | --- |
| `media-window` | `media: {kind: "image" or "video", src: "assets/local-file.ext", sourceStart?: seconds}`; sourceStart is video-only |
| `checklist` | `rows: [{label, status: "pending" or "active" or "done", at, doneAt?}]`; optional `statusLabels: {pending, active, done}` |
| `step-rail` | `steps: [{label, at}]`, with strictly increasing times; optional `numbered: true` |
| `callout` | `body`, a short explanation beneath `title` |
| `audience-grid` | `audience: {tiles: [{label, emoji?, at}], columns?}`; audience tiles are illustrative |
| `trend-chart` | `chart: {mode: "illustration" or "data", points: [{label, value, at}], unit, source?}`; source is required for real data |
| `metric` | `metric: {mode, unit, format, currency?, decimals?, values: [{value, at}], source?}` |
| `progress` | `progress: {mode, values: [{value, at}], max?, label?, source?}` |

Checklist rows begin pending. `status` is the target state at `at`; an active
row may also supply a later `doneAt` to reveal its tick and done state.
Default visible labels are Pending, Active and Done. For an illustrative
explanation, `statusLabels` can use words such as Covered instead of implying
that a real task was completed. Each label is limited to 14 characters.
Event timestamps represent the visible settle, not necessarily the tween start.
Use the returned events rather than recomputing a contact from a guessed delay.

All kinds accept `id`, `kind`, `aspect`, `start`, `duration`, `title`, optional
`rect`, six-digit hex `accent`, `presentation: "solid"` (default) or `"glass"`,
and optional integer `track` (1–98, default
2). Media-window chrome uses the following track; reserve distinct track pairs
for intentional simultaneous media windows. Use `16:9` (1920×1080) or `9:16`
(1080×1920). Default rectangles are starting points, not presenter-safe placement.
Use explicit geometry from the inspected source and target crop. Short copy,
row counts and dimensions have bounds; split dense content instead of squeezing
it into an unreadable panel. The helper's validation errors explain those bounds.

## Reach illustrations and grounded metrics

These kinds require the audience/trend helper update in the installed skill.
If an older helper rejects them, use a supported module or install that update;
do not claim support or fork an unverified local geometry replacement.

Use `audience-grid` to develop a concept of reach or different audience groups,
not as a claim about actual users. Tiles have a short label, optional compact
emoji and a relative `at` highlight time. Columns use a bounded grid rather than
freehand connector geometry. The module keeps an Illustration caption visible.
Choose accents from the video's brand/topic, not a fixed emoji convention; check
that the actual render environment displays the intended glyph cleanly.

Use `trend-chart` for an illustrative numeric trend or actual sourced data.
Point `at` values increase chronologically with at least 0.5 seconds between
events and are offsets from module start;
values must fit the helper's accepted numeric bounds. The counter follows the
selected point's value and unit while the bar chart develops. In `illustration`
mode the persistent caption states Illustration · example values; do not remove
that caption or present the count as a real view/member/result metric. In `data`
mode supply `source` and independently verify the values against it; the helper
requires attribution text but cannot verify its truth. This is a simple bar
trend with a counter, not an analytics capture or proof of future performance.

For example, an explicitly hypothetical reach sequence can use:

```json
{
  "mode": "illustration",
  "unit": "example views",
  "points": [
    {"label": "Share", "value": 100, "at": 0.6},
    {"label": "Discover", "value": 600, "at": 2.2},
    {"label": "Reach", "value": 2400, "at": 4.3}
  ]
}
```

Place that object in `chart` of a `trend-chart` specification with adequate
geometry and dwell, then review encoded readability. Example values are not
promised outcomes. Neither reach module is mandatory: a capture, icon accent or
quiet presenter beat may communicate the passage better. Keep the presenter in
the same established run while swapping related modules; module entry/exit does
not own or recenter the presenter.

## Metrics, progress and numbered steps

These options require the expanded helper catalog in the installed skill. The
familiar patterns are informed by [Magic UI Number Ticker](https://magicui.design/docs/components/number-ticker)
(up/down counts and decimal precision) and [shadcn Progress](https://ui.shadcn.com/docs/components/base/progress).
They are pattern references, not a claim that those React libraries are installed
or that their code drives this HyperFrames composition.

A `metric` uses `mode: "illustration"` or `"data"`, a short `unit`, and
`format: "number"`, `"percent"` or `"currency"`. Set `decimals` explicitly when
precision matters (0–2). Currency uses an explicit three-letter `currency` code;
preserve that code rather than substituting an ambiguous currency symbol.
Percentage metrics use signed percentage points, not fractions: 25 means 25%,
150 means 150%, and -12 means -12%. Progress remains bounded to 0–max.
Number and currency values may also be negative. Choose the real start and end
values for an increase or decrease; direction follows those values rather than
a decorative arrow. Verify the resulting sign, scale and units in encoded frames.

A `progress` uses `values`, optional `max` (default 100) and optional `label`.
Each value must be within 0–max; displayed percentage is relative to that max.
A 3-of-4 stage example means 75%, not 3%. Illustration mode needs its persistent
label; data mode needs `source` and independent verification of the measure.
For both metric and progress, `values` contains relative `{value, at}` entries,
with at least 0.65 seconds between events to accommodate the finite transition.
Use actual emitted settle events for SFX; the first visible value must agree
with the intended starting state rather than implying zero when zero is untrue.

For an illustrative percentage decrease, a metric object can be:

```json
{
  "mode": "illustration",
  "unit": "example rate",
  "format": "percent",
  "decimals": 1,
  "values": [
    {"value": 72.5, "at": 0.6},
    {"value": 48.0, "at": 2.2}
  ]
}
```

Supply it in `metric` of a `kind: "metric"` specification with enough room and
dwell. Source-backed rate changes need a clear denominator/time context; neither
example percentages nor money amounts become real achievements through animation.

Set `numbered: true` on a `step-rail` to use ordered stage markers when the speech
expresses sequence. Numbering does not mean those stages have been completed.
Select `presentation: "glass"` for a footage overlay when the design calls for
it. Check text contrast over the busiest actual source frame and verify blur in
the encoded render; keep a sufficiently opaque tinted fallback when blur fails.
Use solid panels where they communicate better. These catalog options are
available to the director, not a list of effects every video must contain.

## Assemble the fragments

The result contains `html`, `css`, `motion`, `events` and `layout`:

1. Put `html` directly inside the top-level HyperFrames composition root.
   Media-window video and chrome are sibling elements; do not wrap them in a
   media container or sub-composition. The video is muted and uses its supplied
   source offset; preserve one continuous authoritative narration track.
2. Include `css` in the composition's stylesheet. Resolve the project font
   locally and override the template's system font when the brand requires it.
3. Insert `motion` after creating the host's paused GSAP timeline named `tl`;
   register that timeline against the composition ID as required by
   `standalone-hyperframes.md`. The fragment does not create or play a timeline.
4. Use emitted event IDs/times to bind selected SFX in `EDIT-DIRECTION.json` and
   the audio manifest. Events are timing aids, not a mandate for a sound on
   every state change.

Freeze any media to approved project-local `assets/` paths. Probe and inspect it
before selection; the helper does not verify file existence, quality, rights or
readability. Media uses `object-fit: contain` to preserve aspect ratio. Choose a
window rectangle matching the useful crop rather than accepting unwanted bars
or shrinking a detailed screenshot below legibility.

Inspect the assembled entry, state changes, settle and exit in encoded output.
Verify label wrapping, tick alignment, progress endpoints, intentional track overlaps, readable dwell,
presenter/gesture/caption clearance and crop at the actual delivery size. Review
normal-speed motion and encoded sound separately from numerical bounds checks.
A module template or passing checker cannot establish that the edit is usable.

## Choreograph connected sequences

Plan a short sequence before choosing each module's entrance. Name the visible
subject, its initial state, what changes, what carries into the next beat, and
where the audience gets time to read the result. Keep a meaningful shared object
or frame alive across related beats using one stable DOM identity and the host's
paused timeline. For example, a captured media window can remain while a selected
item gains a callout and then becomes the next focus. Replacing every panel with
another directional panel still produces a stack of cards; it does not prove an
object handoff. These fragments supply bounded travel, not automatic shared-object
morphing or a camera engine.

A useful sequence grammar is a persistent header or media frame with a small
thumbnail cluster that resolves into one selected window, followed by a highlighted
excerpt and a contextual badge or task-state change inside that same stage. Use
supplied screenshots when they exist; otherwise make the content visibly conceptual.
This is one narrative pattern, not required branding, layout, or a fixed beat count.
Secondary objects may move while the primary subject holds. Let outgoing labels
lose visibility before incoming labels occupy the same reading zone, and inspect
actual transition frames to choose the overlap; no universal millisecond quota
substitutes for those frames.

Choose placement from the actual footage's face, gaze, negative space, and caption
area. Maintain the same stage and presenter crop across related beats. A change
of emphasis may merit one restrained presenter punch-in; a quiet spoken passage
may return to a clean presenter frame. Do not switch left and right on every beat
or pulse the presenter merely to add activity. A reset should follow a narrative
boundary, a useful scale change, or a deliberately quiet moment.

An optional common `motion` field varies arrival and departure without moving the
reading pose:

```json
"motion": {
  "enter": "right",
  "exit": "left",
  "distance": 64,
  "enterDuration": 0.4,
  "exitDuration": 0.26,
  "scale": 0.98
}
```

Directions name the starting or ending offset relative to `rect`, not the side
where the module must be placed. `left`, `right`, `up`, `down`, and `none` are
supported. Travel distance is 0–96 pixels; arrival duration is 0.2–0.6 seconds;
departure duration is 0.16–0.5 seconds; the travel scale is 0.92–1. The module
rests at its supplied rectangle with scale 1. Supplying `motion` defaults to
up/up, 48 pixels, 0.36/0.28 seconds, and scale 1. Omitting it preserves the
original 18-pixel upward settle and short upward exit. Entrance decelerates;
departure accelerates. The helper rejects motion that leaves less than 0.5 seconds
of stationary hold; give longer copy substantially more reading time. Content
cue offsets must follow arrival and settle before departure.

Returned `layout.motion` contains absolute `enterEnd`, `exitStart`, and `end`
times when this field is supplied. The host owns clip starts, durations, tracks,
and sequence scheduling. For a short panel exchange, an outgoing module could
start at 12 with duration 4 and departure duration 0.26; its departure begins at
15.74. An incoming module can acquire its pose over 0.4 seconds. When both contain
text in the same zone, start the incoming module at 16 after the outgoing copy
clears; overlapping their whole fades produces doubled, unreadable text. Overlap
movement of a shared subject or panels in distinct non-conflicting zones instead,
using different tracks and only their travel windows. Two panels must never hold
over each other. Pair travel directions and object trajectories to express the
relationship, keep face/captions clear throughout travel, and check painted
frames rather than assuming a timing receipt guarantees readability.
Prefer one persistent object to such a replacement when the narration describes
the same subject continuing to change.

Root media remains a direct child of the composition. Its motion shares the
chrome's screen pivot, timing, opacity, and scale; do not nest the video inside a
moving wrapper or animate its clock. Optional travel uses only deterministic
translation, scale, and opacity. Animated CSS filter blur is not offered by this
helper because it is outside the bundled visual-property contract. Static glass
backdrop blur is a separate supported treatment. A brief host-authored streak
may use finite, aria-hidden icon echoes that collapse into the same subject;
keep any such treatment confined to travel and prove seek-safe cleanup. Never
blur held text or the presenter's face.

Choose a small sound vocabulary for the whole sequence: a soft travel cue for an
exchange, a precise tick for a selection or completion, and a restrained accent
for an important focus change. Trigger cues at the actual visible contact or
settle from the emitted events, using authorized local audio. Leave most quiet
holds and spoken pauses unscored. Normal-speed audiovisual playback is required
to judge fluidity and sound; snapshots and signal checks cannot certify it.

Verify a representative exchange at arrival, stationary hold, departing midpoint,
overlap, and exact end, then seek last → first → midpoint → last. Check that media
and chrome stay attached, only travel intervals overlap, content is sharp in its
hold, and every departed module clears completely. Review a landscape and a
portrait layout at the intended delivery size before expanding the edit.
