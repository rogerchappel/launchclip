# Recorded editorial UI modules

<!-- renderer: hyperframes -->
Use the skill-local `scripts/editorial-ui-modules.mjs` helper for a consistent
browser/desktop media window, checklist, step rail, callout, audience grid or
trend chart, formatted metric or progress bar. These are bundled
HTML/CSS/GSAP templates, not installed Radix or Magic UI components. Window
chrome follows LaunchClip's existing `src/hyperframes_assembler.js` treatment;
checkmark geometry comes from its shipped `public/icons/check.svg`.
<!-- /renderer -->
<!-- renderer: remotion -->
Use the bundled editorial modules for a consistent browser/desktop media
window, checklist, step rail, callout, audience grid or trend chart, formatted
metric or progress bar. In this skill they are frame-pure React components in
`assets/remotion-kit/modules/` that render the model resolved by
`scripts/editorial-core.mjs`; the skill-local `scripts/editorial-ui-modules.mjs`
helper validates the same specification and reports its events and layout.
They are not installed Radix or Magic UI components. Window chrome matches
LaunchClip's HyperFrames treatment for the same kind; checkmark geometry comes
from its shipped `public/icons/check.svg`.
<!-- /renderer -->

The helper provides reusable geometry and finite animation fragments; it does
not choose moments, validate facts, measure a real product's progress or approve
creative quality. Choose modules through `recorded-video.md` and keep the same
source and audio contracts.

## Decide each beat before authoring

Before generating modules for a directed recording, complete this decision table
in `STORYBOARD.md`. Choose the visual's function from the actual transcript and
intended viewer response, then choose the capability that serves it. Catalog
availability is not a reason to add a graphic.

| Accepted time / spoken anchor | Intended viewer emotion or understanding | Visual function / changing subject | Chosen capability | Sound function | Caption zone |
| --- | --- | --- | --- | --- | --- |
| Exact earliest claim word and its measured time | What should become clearer or felt here? | What visible action makes that happen? | Why does this particular module or shared object fit? | What should the sound communicate, or why silence? | Which tested region stays clear of face and graphic? |

Arguments, credibility statements, and community offers do not default to
checklists. An argument may need one phrase emphasized or a meaningful comparison;
credibility may need a real excerpt or relevant supplied evidence; a community
invitation may need warmth, an audience relationship, or a clean presenter hold.
Use a checklist for an actual sequence of tasks or conditions, and a rack for
meaningful supplied state signals. Neither implies that the presenter completed
an imaginary task. A strong emotional passage can benefit from less UI, a
restrained presenter focus, and a deliberately quiet sound bed.

Review the whole table before authoring. Identify repeated module and sound
families, and record why each repeat carries meaning or continues the same subject.
Change a repeated treatment when it merely restates narration. Keep repetitions
that develop a continuing object or make a comparison clearer. Do not impose a
fixed graphic count, forced treatment rotation, or mandatory side switch.

Mark acquisition and settle times against measured speech. Start from the
**earliest spoken word that establishes the claim**, rather than waiting for the
sentence to finish or using the next chapter boundary. Let the subject develop
with the claim and land the key emphasis on the relevant word. Compare the actual
first cue time with the visual start in the rendered timeline; repair arbitrary
lags and premature reveals. Do not change the spoken content to accommodate a
chosen widget.

For requested captions, favor two- or three-word chunks derived from accepted
speech timing, with shorter chunks for natural emphasis and longer holds when
reading needs them. Check coverage across all captioned speech, including quiet
presenter passages and returns between graphics; inspect gaps, dropped words, and
timing after cuts. Place captions in an adaptive face-safe zone opposite the
active graphic where possible, stable across a shared layout run. Inspect the
face, hands, platform UI, and graphic bounds at transition frames as well as
holds. Switch zones only when the actual layout requires it, not every beat.

If an elapsed-progress line is part of the treatment, give it one clock for the
**whole accepted video**, from zero to its true end. The host keeps it alive across
overlays; overlay replacement must not reset it. An explicit chapter marker can
sit on that same clock without inventing section counts or progress data. Label
actual process or product progress differently and require supplied evidence.
<!-- renderer: hyperframes -->
The elapsed clock belongs to the host: use one linear (`ease: none`) fill tween
from zero to the accepted duration. The helper's `progress` states express explicit
values, not an automatic elapsed-time clock; do not combine their discrete fill
animations with a second host tween on the same property.
<!-- /renderer -->
<!-- renderer: remotion -->
The elapsed clock belongs to the host: compute one linear fill as
`frame / durationInFrames` from zero to the accepted duration. The module's
`progress` states express explicit values, not an automatic elapsed-time clock;
do not combine their discrete fill animations with a second host-driven value on
the same property.
<!-- /renderer -->

Build a small sound vocabulary around meaning: travel for a handoff, a restrained
accent for a genuine emphasis, a confirmation sound for a real completion, or no
cue during an intimate or dense passage. Module events provide synchronization
points, not instructions to play a tick at every event. Audit repeated tick
density, cue coverage, quiet space, and competing speech in normal-speed playback.
Review caption gaps and repeated visual/sound families alongside the decision
table; repair the specific failure instead of targeting a universal quota.

## Generate a module

<!-- renderer: hyperframes -->
Save a module specification in the composition project, then run:

```bash
node <installed-skill>/scripts/editorial-ui-modules.mjs <project>/module.json > <project>/module-fragments.json
```

Use the actual installed skill path. This makes no model or provider calls and
writes no media. Alternatively import `buildEditorialModule(spec)` from the
same script in a local authoring tool.
<!-- /renderer -->
<!-- renderer: remotion -->
Save a module specification in the composition project and validate it:

```bash
node <installed-skill>/scripts/editorial-ui-modules.mjs <project>/module.json > <project>/module-fragments.json
```

Use the actual installed skill path. This makes no model or provider calls and
writes no media; read its `events` and `layout`, and ignore the HyperFrames
`html`, `css` and `motion` fragments. Alternatively import
`resolveEditorialModule(spec)` from `scripts/editorial-core.mjs` in a local
authoring tool. Then move the specification into `storyboard.json` as described in
[Assemble the fragments](#assemble-the-fragments).
<!-- /renderer -->

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
`rect`, optional `density` (`"fill"` or `"fixed"`), six-digit hex `accent`, `presentation: "solid"` (default) or `"glass"`,
and optional integer `track` (1–98, default
2). Media-window chrome uses the following track; reserve distinct track pairs
for intentional simultaneous media windows. Use `16:9` (1920×1080) or `9:16`
(1080×1920). Default rectangles are starting points, not presenter-safe placement.
Use explicit geometry from the inspected source and target crop. Short copy,
row counts and dimensions have bounds; split dense content instead of squeezing
it into an unreadable panel. The helper's validation errors explain those bounds.

### Defaults and density

Without `rect`, the footprint comes from the content rather than a fixed box:

- **9:16, full-frame Shorts.** The card spans the safe-zone width (x 90, width
  840, inside x 80–940). Its height is the content's natural height, and it
  sits above the caption band (y 280–1190), centred near y 880: on the
  centre-of-mass target and just below the lower-third line, so the lower
  third is never empty. When content is too tall for that band the card may
  grow down to the safe-zone bottom (y 1450); when it does not fit the
  safe-zone width at all it falls back to the old `{x: 90, y: 960, width: 900,
  height: 740}` footprint.
  A short card is never shorter than 160 px.
- **Type scale (9:16 and derived 16:9).** The module lays out in a smaller layout box and renders
  scaled into its rect (`model.density.scale`, 1–2). The resolver picks the
  largest scale at which the content still validates and fits, preferring at
  least 1.8 with the card centre below the lower third. At 1.8–2 titles render
  at 50–56 px and body copy at 43–48 px, meeting the 44 px key-text rule. The
  metric number grows to a hero size (up to 240 px); a progress number caps
  lower (about 160 px) because the bar is that card's hero. Explicit 9:16
  rects keep their footprint and get the same scale search, so text grows only
  as far as the rect allows; a rect that fits nothing larger resolves exactly
  as before.
- **16:9, full frame.** The default card is centred horizontally, 1000 px
  wide (1440, then the whole 1728 px title-safe width, for content too dense
  for that), inside the landscape title-safe zone and above the caption band
  (y 96–840; the band starts at y 864), centred on the frame where it fits. It
  gets the same type-scale search (1–1.75), so body copy reads about 45 px and
  titles about 53 px on a 1920-wide frame: a big, confident panel that hugs its
  content instead of small text in a large dark card.
- **Explicit 16:9 rects** resolve at scale 1 by default, so existing
  footprints stay byte-identical: text does not grow with the rect, and a
  bigger rect is just more empty panel. Add `density: "fill"` (in a storyboard,
  `params.density`) to give an explicit 16:9 rect the type-scale search, so
  the text grows to fill it. `density: "fixed"` keeps scale 1 in either aspect.
- **media-window** keeps scale 1. Its 9:16 default is an 840×521 window (a
  16:9 frame under the 48 px bar) centred on the target; its 16:9 default is a
  centred 1200×723 window (16:9 media under the bar) above the caption band.

**Recommendation:** omit `rect` and let the module size itself; when the shot
needs a specific footprint in 16:9, add `density: "fill"` so the panel's text
fills it. `launchclip module fit <module> --params params.json --aspect 16:9`
prints a spec's natural size, or for a given rect the minimum height at its
width and the width that fits its height.

Rect-local geometry in the model (`chrome`, cells, bars, stages) is in layout
px; multiply by `model.density.scale` for canvas px. `model.rect` and
`layout.rect` are always canvas px. Both renderers wrap the kind markup in one
`.ui-density` element sized to `model.density.layout` with
`transform: scale(model.density.scale)` from the top-left corner, omitted at
scale 1.

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
<!-- renderer: hyperframes -->
They are pattern references, not a claim that those React libraries are installed
or that their code drives this HyperFrames composition.
<!-- /renderer -->
<!-- renderer: remotion -->
They are pattern references, not a claim that those React libraries are installed
or that their code drives this Remotion composition.
<!-- /renderer -->

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

<!-- renderer: hyperframes -->
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
<!-- /renderer -->
<!-- renderer: remotion -->
In the Remotion skill a module is a `storyboard.json` scene, not pasted fragments:

1. Add a scene whose `id` is the module `id`, whose `module` is the `kind`, and
   whose `start` and `end` cover the module's `start` and `start + duration`.
   Put every other field (`rect`, `title`, `accent`, `theme`, `motion`, and the
   kind's content fields) in `params`, leaving out `id`, `kind`, `aspect`,
   `start` and `duration`, which come from the scene and the format.
   Media-window video renders as a muted `<OffthreadVideo>` inside the module
   with its supplied source offset; preserve one continuous authoritative
   narration track in the root mix.
2. Editorial modules draw with the bundled registry stacks (Inter, JetBrains
   Mono; `kit/core/fonts.mjs`), which `ensureFonts(story.brand)` loads from
   local files before the first frame. Never load a font from the network.
3. `LaunchclipStory` places each module in its own `<Sequence>` and the module
   derives every value from `useCurrentFrame()`, following
   `standalone-remotion.md`. Never add a GSAP timeline, CSS transition, or
   state-driven animation to a module.
<!-- /renderer -->
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
<!-- renderer: hyperframes -->
where the audience gets time to read the result. Keep a meaningful shared object
or frame alive across related beats using one stable DOM identity and the host's
paused timeline. For example, a captured media window can remain while a selected
<!-- /renderer -->
<!-- renderer: remotion -->
where the audience gets time to read the result. Keep a meaningful shared object
or frame alive across related beats using one component that stays mounted
across the whole run (one scene or one long `<Sequence>`) and derives its state
from the frame. For example, a captured media window can remain while a selected
<!-- /renderer -->
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
<!-- renderer: hyperframes -->
times when this field is supplied. The host owns clip starts, durations, tracks,
and sequence scheduling. For a short panel exchange, an outgoing module could
<!-- /renderer -->
<!-- renderer: remotion -->
times when this field is supplied. `storyboard.json` owns scene starts, durations,
tracks, and sequence scheduling. For a short panel exchange, an outgoing module could
<!-- /renderer -->
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

<!-- renderer: hyperframes -->
Root media remains a direct child of the composition. Its motion shares the
chrome's screen pivot, timing, opacity, and scale; do not nest the video inside a
moving wrapper or animate its clock. Optional travel uses only deterministic
<!-- /renderer -->
<!-- renderer: remotion -->
Media-window video stays inside its module's chrome. Its motion shares the
chrome's screen pivot, timing, opacity, and scale; do not nest it in a second
moving wrapper, change its `playbackRate`, or offset its clock from the scene
start. Optional travel uses only deterministic
<!-- /renderer -->
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

## Developer-style details and compact widgets

Use the optional details selectively. A meaningful symbol, one highlighted phrase,
and a quiet edge can establish a developer-oriented visual language without
animating everything. Use supplied branding separately; the built-in symbols are
locally authored terminal, branch, users, and rocket glyphs, not product logos.
Colors follow the existing `accent` input. No external icon HTML, arbitrary SVG,
network font, or dependency is accepted.

A callout may include `treatment`:

```json
{
  "icon": "terminal",
  "monospace": true,
  "glow": true,
  "corners": true,
  "at": 0.5,
  "segments": [
    {"text": "Keep "},
    {"text": "the useful idea", "highlight": true},
    {"text": " in focus."}
  ]
}
```

`segments` replaces `body`; do not supply both. Supply spaces explicitly between
segments. The joined copy is limited to 160 characters, with at most 12 segments.
`icon`, `monospace`, `glow`, `corners`, and `segments` are optional. With no segments,
use the ordinary `body`. `at` defaults to the module's arrival end and is relative
to `start`. Icon, copy, accent outline, and four corner brackets acquire separately
and settle within 0.4 seconds. The glow is a static soft shadow plus a finite
opacity reveal, never an animated CSS filter or shadow. External corners require
12 pixels of canvas clearance; the helper checks copy fit and rejects undersized
cards. Omit `treatment` to retain the original callout output exactly.

| Kind | Required content |
| --- | --- |
| `date-card` | `date: {month: 1..12, day: 1..31, year?, caption?, at}`; calendar-valid integers, optional caption ≤42 characters |
| `status-rack` | `rack: {mode: "illustration" or "data", source?, rows: [{label, states: [{at, lights: [boolean, boolean, boolean]}]}]}`; 1–8 rows, 1–8 states per row |
| `code-snippet` | `code: {language?, lines: [{at, tokens: [{text, type}]}]}`; 1–3 lines, 1–24 tokens per line |

The date card uses a colored month band, a large independently settling day, and
short context. A supplied year validates leap days; without a year February 29
is allowed. The helper never reads the current date. Choose meaningful actual
milestones or visibly hypothetical dates rather than implying an unverified
announcement.

Status racks use compact monospaced rows and three 18-pixel indicators. Rows
acquire on their first state; subsequent lights can turn on or off. State offsets
must strictly increase by at least 0.3 seconds within each row. Repeating unchanged
lights emits no extra sound event. Illustration mode retains a visible label;
real data requires a source attribution. A light turning on represents the
supplied state, not a software/security certification. Shorten labels to fit the
chosen width; the helper rejects overfull racks.

Code token types are `plain`, `keyword`, `string`, `number`, `comment`, and
`operator`. Explicit typed tokens receive restrained syntax colors, and each
line acquires independently. Preserve spaces in token strings; tabs/newlines are
rejected. Line offsets must increase by at least 0.3 seconds. Lines must fit their
width without scrolling or clipping, so show a short excerpt instead of an entire
program. Token styling does not parse or execute code. The language label is
optional; the module retains an `Example` marker rather than implying product
proof. All copy is escaped.

These widgets accept the existing aspect, rect, track, accent, and directional
motion options. Supply explicit rectangles appropriate to the footage and inspect
both aspect ratios at delivery size. Local monospace fallbacks are used; a project
may separately freeze and declare an authorized font. Content settles before the
exit begins, and emitted events identify the actual state/accent settle. Check
forward and reverse seeks, and judge the integrated scene's normal-speed playback
before expanding it.

## Focused browser excerpts and text variants

Use `excerpt-window` for a short, supplied or visibly illustrative document excerpt,
not a reconstructed live browser or a claim that a real website was captured:

```json
"excerpt": {
  "mode": "illustration",
  "lines": [
    {"segments": [{"text": "Build a useful thing."}]},
    {"segments": [{"text": "Make the "}, {"text": "next step", "highlight": true}, {"text": " clear."}]}
  ],
  "focus": {"line": 1, "scale": 1.2, "at": 1.2}
}
```

Browser chrome and the visible illustration/source note remain fixed while the
inner text scales and pans to the chosen line, then the highlights acquire.
`focus.line` is zero-based, `scale` is 1–1.3, and `at` is relative to module start.
Use 1–5 short lines with 1–12 segments per line. Text must fit at focused scale;
the helper validates the maximum zoom and computes a bounded pan from the fixed
geometry. It never measures layout at render time, fetches a URL, accepts HTML,
or clips required text to simulate a focus. `mode: "data"` requires `source`;
illustration mode cannot claim an actual source. Preserve spaces explicitly.

Two extra callout symbols, `check` and `warning`, support confirmation and caution
without branded imagery. The title acquires independently of the subtitle/body.
A segment can add `underlineAt`, a relative cue after the treatment has settled:

```json
"segments": [
  {"text": "Review "},
  {"text": "before release", "highlight": true, "underlineAt": 2.4}
]
```

The underline grows separately beneath sharp, stationary text and emits its own
settle event. Underlined phrases must fit on one line; long or early underlines
are rejected. Use title, body/segments, rectangle, and existing treatment options
to compose variants instead of adding many presets: a compact icon/title/subtitle
card; a restrained monospace statement with one late underline; or a rounded
badge-like callout with a short title and a highlighted action. Select variants
from meaning and available footage space, not a repeated rotation schedule.

Whole-stage polish belongs to the host composition. A restrained brand palette
may use a warm background, cream type, and darker surfaces while retaining one
primary accent. Low-contrast, large topic symbols can persist behind the stage
and move between meaningful states with finite translation, rotation, and opacity;
keep them away from the face, captions, and held copy. A bottom elapsed-progress
<!-- renderer: hyperframes -->
line can reuse the progress-bar treatment with a host-owned linear tween derived
from the whole accepted video's elapsed time. Keep one persistent clock across overlays, and
<!-- /renderer -->
<!-- renderer: remotion -->
line can reuse the progress-bar treatment with a host-owned linear value derived
from the whole accepted video's elapsed frames. Keep one persistent clock across overlays, and
<!-- /renderer -->
label it as video progress rather than fictional product completion. Neither background glyphs nor progress should force constant motion.
Use real chapter/section timing; do not invent recording indicators, chapter
counts, brand claims, or facts from a style reference. Inspect the complete frame
and its transitions, not just isolated widget screenshots.


## Optional palette tokens

Supply a common `theme` to use the same geometry with a different palette. The
four required tokens are `surface`, `foreground`, `muted`, and `border`, each a
six-digit hex color. Optional `accentText` defaults to `foreground`; the separate
existing `accent` remains the primary graphic fill, line, and glow color. Palette
colors affect scoped module surfaces, rows, chrome, text, code tokens, and inactive
signals. Completed checklist rows and switched-off rack lights return to the
chosen palette when seeking, rather than restoring the original navy colors.
Omitting `theme` preserves existing HTML, CSS, motion, events, and layout output.
No arbitrary CSS, network font, or new rendering engine is accepted.

A warm light-surface recipe, independent of any particular brand:

```json
"accent": "#FF6A00",
"theme": {
  "surface": "#FFF1CE",
  "foreground": "#171612",
  "muted": "#5D5548",
  "border": "#9B8769",
  "accentText": "#A43C0A"
}
```

Use the bright orange for graphic energy and the darker orange for readable
emphasis on cream. For a charcoal surface, a companion recipe is surface
`#171612`, foreground `#FFF1CE`, muted `#D0C4A8`, border `#736A57`, and accentText
`#FF9D4C`. Choose surfaces from the emotional function and footage context, not a
forced alternating pattern. Glass keeps a translucent tint based on the supplied
surface; media itself stays sharp. Accent-filled date/step badges retain dark ink.
Palette validation checks syntax, not aesthetic quality or universal contrast:
verify actual held text, syntax colors, glass over footage, and transition frames
at delivery size using both browser and native render checks.

## Focus decisions and developing reach

Choose `focus-flow` when the spoken idea resolves meaningful competing choices
into one chosen task, then makes progress on that same task. Supply two to four
short, distinct option labels and a zero-based `selected` index. The selected
option keeps its identity as it moves to the center; distractors fade before
converging, rather than becoming three anonymous boxes around an unrelated build.
Do not use this scene for every argument or for an already simple task list.

```json
{
  "id": "focus", "kind": "focus-flow", "aspect": "16:9",
  "start": 0, "duration": 8.95, "title": "One chosen task",
  "rect": {"x": 80, "y": 695, "width": 1120, "height": 340},
  "focus": {
    "options": ["Research", "New tools", "Side quests", "The next build"],
    "selected": 3, "arriveAt": 0.28, "chooseAt": 1,
    "progressAt": 5.5, "progressDuration": 0.8,
    "progressLabel": "The next build"
  }
}
```

Offsets are relative to module start. Acquisition takes 0.24 seconds per option
with 0.08 seconds between options; `chooseAt` must leave another 0.2 seconds to
read them. `progressAt` must follow choice by at least 0.9 seconds. Progress lasts
0.3–2 seconds (default 0.8), with a further 0.35-second hold before departure.
The progress is visibly illustrative, not measured product completion. Optional
`icon` uses the existing symbolic registry. Labels are at most 24 characters;
progress copy is at most 32, subject to conservative fitting validation.
Landscape panels at least 900 pixels wide arrange options horizontally; narrower
panels and portrait use a stack. Four portrait options need a taller panel
(for example 900 × 580), not a compressed landscape lower third.

Choose `growth-chart` for increasing reach or distribution over time.
`audience-grid` expresses people and relationships; repeating audience tiles
for both belonging and scaling loses that distinction. Growth defaults to four
staged relative bars with a persistent **Illustration · relative growth** label
and no invented numerical reach claims:

```json
{
  "id": "reach", "kind": "growth-chart", "aspect": "16:9",
  "start": 0, "duration": 4.68, "title": "Reach develops",
  "rect": {"x": 70, "y": 240, "width": 1050, "height": 640},
  "growth": {"mode": "illustration", "unit": "reach"}
}
```

Optional `points` contain two to eight `{label, value, at}` entries: short labels
(up to 16 characters), whole nonnegative values up to one billion, and increasing
relative times at least 0.5 seconds apart. Values must not decrease; use
`trend-chart` for declines. Supplied illustrative values retain the persistent
example-values label. `mode: "data"` requires supplied points and a short `source`;
the helper checks shape, not the truth of that source. `showValues: false` hides
the metric while preserving the relative bars and attribution. Without supplied
points, default illustration needs room for acquisition, four events and a hold;
shorten neither the source speech nor reading time to fit an arbitrary widget.

Before choosing either module, inspect supplied screenshots, logos, icons and
clips. Use a real asset when it communicates the actual subject better than a
synthetic scene; place it through the existing media or excerpt contract. Assets
are useful evidence, not a prerequisite for a complete editorial treatment.
Explain repeated visual families in the beat table: repeat to continue an object
or relationship, not merely to swap labels. A distinct meaning can justify a
distinct capability without mandatory visual rotation.

Use `presentation: "solid"` for a readable panel over busy footage. Choose glass
only when translucency serves the scene and tested negative space supports it;
inspect the actual background and delivery size rather than relying on an alpha
value. Keep the source face and captions clear through transitions and holds.

Plan sound by meaning: acquisition, removal, commitment, travel or growth may
need different roles, or silence. Do not attach a tick to every returned event.
Audition intended cues alone and in the actual dialogue/music mix at normal
speed; check masking and whether the intended action is audible. A populated
cue list, waveform or nonzero sample count does not demonstrate audible craft.
Keep dialogue clear and record listening approval separately from visual checks.

## Tie typing sound to visible typing

A typing sound means text is visibly appearing character by character. A full
line acquisition, a claim badge, a chart bar contact, or a progress change is not
typing. Use an appropriate contact, acquisition, notification cue or silence for
those actions; do not reuse a typing recording just because it sounds energetic.

Code snippets can opt into deterministic character reveal without changing old
full-line behavior:

```json
"code": {
  "typing": true,
  "lines": [{
    "at": 0.5, "typeDuration": 0.8,
    "tokens": [{"text": "const ", "type": "keyword"},
               {"text": "value = 7;", "type": "plain"}]
  }]
}
```

Each line's `at` starts its visible typing span; `typeDuration` is 0.12–2 seconds
<!-- renderer: hyperframes -->
(default 0.6). Characters keep their syntax color and whitespace and are keyed
on the registered timeline, so backward seeking restores the partial text.
<!-- /renderer -->
<!-- renderer: remotion -->
(default 0.6). Characters keep their syntax color and whitespace and are derived
from the current frame, so backward seeking restores the partial text.
<!-- /renderer -->
Typing lines cannot overlap, must retain the existing minimum line spacing, and
must finish before departure. Choose readable short examples; fast sound does
not justify cramming long code into a short speech beat.

The helper emits `-code-i-typing-start` with absolute `time`, `endTime`, `duration`
and `role: "typing"`, plus a matching `-typing-end`. The existing `-settle` event
marks the completed line. The host owns audio: gate a locally supplied typing
recording to those spans, avoid its silent head/tail, and stop it at the visual
completion. Events do not automatically add sound. Ordinary callout and excerpt
acquisitions remain non-typing unless the host actually authors visible typing.

Check the encoded visual and audition the actual mix together at normal speed.
Verify onset, completion, gaps between spans, audibility beneath narration and
whether repeated typing becomes distracting. Signal presence alone is not
listening approval. Omitting `code.typing` preserves the existing markup, motion
and events, so earlier compositions remain unchanged.

## Animate excerpt emphasis

Set `excerpt.highlightMotion: true` to sweep the background of highlighted
segments from left to right over 0.35 seconds at `excerpt.focus.at`. A separate
background layer scales; the text keeps its normal shape. Existing whole-excerpt
focus travel remains independent. Highlight the relevant phrase on its measured
spoken emphasis, rather than leaving every excerpt permanently accented or
acquiring an unrelated highlight at a chapter boundary.

The sweep is finite and restores partial states on backward seeks. It must
settle before departure, alongside the existing focus movement. The helper adds
a `-highlight-sweep-settle` event; it does not automatically add sound. Omit the
option to retain the previous background-color acquisition and original output.
Inspect the encoded phrase at onset, midway and completion for alignment,
readability and correct timing with speech.

Match the mechanism to the subject: use a background sweep for an excerpt,
a drawn underline for a critical phrase, or a brief color transition at a
caption/callout emphasis. Keep glyph size steady during a color change. These
are distinct actions; a color transition is not a marker wipe. Caption emphasis
can acquire color at the actual word onset, while a callout can acquire its
accent after text settles. Check measured speech rather than assigning every
emphasis the same arbitrary delay.
