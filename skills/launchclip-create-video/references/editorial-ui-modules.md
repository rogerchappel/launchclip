# Recorded editorial UI modules

Use the skill-local `scripts/editorial-ui-modules.mjs` helper for a consistent
browser/desktop media window, checklist, step rail, callout, audience grid or
trend chart. These are bundled
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
| `step-rail` | `steps: [{label, at}]`, with strictly increasing times |
| `callout` | `body`, a short explanation beneath `title` |
| `audience-grid` | `audience: {tiles: [{label, emoji?, at}], columns?}`; audience tiles are illustrative |
| `trend-chart` | `chart: {mode: "illustration" or "data", points: [{label, value, at}], unit, source?}`; source is required for real data |

Checklist rows begin pending. `status` is the target state at `at`; an active
row may also supply a later `doneAt` to reveal its tick and done state.
Default visible labels are Pending, Active and Done. For an illustrative
explanation, `statusLabels` can use words such as Covered instead of implying
that a real task was completed. Each label is limited to 14 characters.
Event timestamps represent the visible settle, not necessarily the tween start.
Use the returned events rather than recomputing a contact from a guessed delay.

All kinds accept `id`, `kind`, `aspect`, `start`, `duration`, `title`, optional
`rect` and optional six-digit hex `accent`, and optional integer `track` (1–98, default
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
