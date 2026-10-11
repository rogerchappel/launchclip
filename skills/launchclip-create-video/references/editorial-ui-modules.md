# Recorded editorial UI modules

Use the skill-local `scripts/editorial-ui-modules.mjs` helper for a consistent
browser/desktop media window, checklist, step rail or callout. These are bundled
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
