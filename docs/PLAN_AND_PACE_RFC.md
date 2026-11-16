# RFC: Sharper plans, faster pace, measured references

Status: phase 1, the plan side of phase 2 and the audio port of phase 3 built (see "Built so far" at the end of §2 and §4.3); the rest is a draft open for review
Date: 2026-11-16
Roadmap entry: "Sharper plans and a faster hook" ([ROADMAP.md](ROADMAP.md))

> Code and prompt text from other projects are copied only where their licence allows it, with the notice kept. Everything else here is written fresh in our own words. Every source, its licence and what we take from it is listed under Provenance.

The best hand-written video briefs we studied share a shape. They state the
idea in one line, name one object that carries the film, list what is
banned, lock the exact words, say what each transition proves, plan the
silences, and put every move on a bar grid. Our planner asks for none of
this. Our pace checks catch dead air (`holds`: nothing moves for 3 s) but
not a slow hook or a move that lands a frame late. Our reference reader
guesses transitions from shot length (`grammarFromPacing`,
`src/style_reference.js` ~L807) when it could measure them.

This section adds three things:

| # | What | Where it lives | Phase |
|---|---|---|---|
| 1 | A `treatment` block in the direction map, each field with a check | `kit/core/direction.mjs`, `kit/core/planning-prompt.mjs` | 1 |
| 2 | A pace gate: hook density, longest gap, anticipation, bar timing | new `kit/core/pace-check.mjs`, `motion-check.mjs`, `src/quality_gates.js` | 2 |
| 3 | Measured transitions, entrances, SFX, tempo and calm cut points | `src/style_reference.js`, `src/render_motion_analysis.js`, `src/render_audio_analysis.js`, profiles | 3–6 |

## 1. New plan fields

The fields live in `DIRECTION.json` (`launchclip.direction-map.v1`, bumped to
v2 with the old shape still read) as one `treatment` block. The planner writes
it before the storyboard. Every field is optional on the structured tier and
required on bespoke.

```json
{
  "treatment": {
    "concept": "One cursor blink grows into every tool the agent can reach.",
    "throughline": {
      "object": "signal-dot",
      "states": [
        { "at": "s1", "form": "cursor" },
        { "at": "s2", "form": "node", "carry": "card-to-card" },
        { "at": "s4", "form": "stream" },
        { "at": "s6", "form": "logo-dot" }
      ]
    },
    "banned": ["crossfade", "particles", "lens-flare", "camera-shake", "bounce-ease", "hold>1.0", "brand-before-end"],
    "locked_copy": { "only": true, "lines": ["What can one API become?", "One pattern. Every modality."] },
    "guardrails": [{ "claim": "release status", "forbid": ["stable", "v1.0"] }],
    "locked_example": { "label": "first six primes", "values": { "product": 30030, "plus_one": 30031, "factors": [59, 509] } },
    "transitions": [
      { "from": "s3", "to": "s4", "type": "morph", "demonstrates": "one stream splits into text, audio and image" },
      { "from": "s4", "to": "s5", "type": "push", "demonstrates": "an interrupted stream resumes from the same point" }
    ],
    "signature": { "at": "s5", "describe": "the stream freezes mid-word, then picks up exactly where it stopped" },
    "sound": {
      "silences": [{ "at": "word:but-0.6", "dur": 0.5, "then": "impact" }],
      "prelaps": [{ "into": "s4", "lead": 0.4, "kind": "j" }],
      "pace_change": { "at": "s4", "from": "build", "to": "rush" },
      "breath": { "at": "s6", "dur": 0.45 },
      "drop": { "at": "s5", "lead_beats": 8 }
    }
  }
}
```

| Field | Planner prompt wording (ours) | Guardrail that checks it |
|---|---|---|
| `concept` | "Say the whole film in one sentence of at most 20 words. It names a thing that changes, not a topic." | Validation: present, ≤ 20 words, contains a verb, is not the title. The critic rubric scores every scene against it. |
| `throughline` | "Pick one object that is on screen from the first scene to the last and changes form at each section. List its forms in order." | Validation: `object` is an element id in each named scene; a section with no state warns. Render: the carried element's rect is continuous across each boundary (the `carry` check from the fluid-motion RFC, landing within 4 px). |
| `banned` | "List what this film must never do. Start from the style's list and add the brief's. Use the listed words where one fits." | Validation maps tokens to checks: `crossfade` → no `fade` between two full-frame scenes; `bounce-ease` → no `back`/`elastic` with overshoot > 1.7; `camera-shake` → no `shakeOps` or kicks; `hold>N` → the pace gate's `max_still`; `brand-before-end` → no logo or wordmark element before the last 15% of runtime. Free-text items go to the critic only. |
| `locked_copy` | "Copy the brief's exact words here, in order. Do not reword them. With `only`, show no other slogans." | Validation: each line appears verbatim (case-folded, punctuation kept) in scene text or narration, in order. With `only`, any headline-sized text not in the list or the narration warns. |
| `guardrails` | "Write down each claim you must not overstate, and the words that would overstate it." | Validation: no `forbid` phrase in any scene text, caption or narration. |
| `locked_example` | "When the film works an example, fix its numbers once here and reuse them everywhere." | Validation: every number in a scene's params that matches a `values` key by label equals it. A `check` expression (optional) is evaluated. |
| `transitions[].demonstrates` | "For every scene change, say in a few words what the change itself shows. A transition that shows nothing is a cut." | Validation: every non-cut boundary has an entry; `demonstrates` has ≥ 3 words and is not a transition-type name. More than one `fade` per 30 s warns. |
| `signature` | "Name the one shot people will remember. Describe it without effect names." | Validation: `describe` contains no word from the effect vocabulary (`TRANSITION_TYPES`, glow, blur, particles…); the scene lands between 25% and 85% of runtime; `cover.frame` defaults to it. |
| `sound.silences` | "Before the turn, plan a near-silence, and say what breaks it." | Validation: one for 20 s and longer, two for 45 s and longer; `then` is a hit moment (`impact`, `reveal`, `wonder`). Render: the window's RMS is ≥ 18 dB under the mix median, and a transient lands within 0.1 s of its end. |
| `sound.prelaps` | "Let the next scene's sound start early (j) or the last scene's run over the cut (l), at least twice in a minute." | Validation: `lead` 0.15–1.0 s. The mixer offsets the scene's first cue by `lead`. |
| `sound.pace_change` | "Mark where the film speeds up or slows down on purpose." | Pace gate: the events per minute of the sections either side differ by ≥ 1.5×. |
| `sound.breath` | "Give the viewer one held moment, 0.4 s or more, where nothing moves." | Plan: no tween runs in the window except idle (the motion check reads the ops). Render: stillness spans it. A declared breath is exempt from `max_still`. |
| `sound.drop` | "If the music has a drop, start the track so it lands on the signature." | `audio.music` offset is solved from the track's measured section change (§4.3). |

The planner prompt lines go in a new `treatmentLines()` beside
`guardrailLines()`. The style pack gains `avoid` tokens so `banned` starts
from the look, not from nothing.

## 2. The pace gate

Four rules, checked on the plan (beat map events, ops, `BEATS.json`) and
again on the render:

- **Front-loaded hook:** the opening window has more events per second than
  the body.
- **Longest gap:** no stretch without a new event (entrance, state, camera
  move) longer than the band; no frozen pixels longer than `max_still`.
- **Anticipation:** a move tied to a beat or a hit reaches half its travel
  within one frame of that beat. The compiler starts it early by the ease's
  half-travel time (GSAP's power3 is a quartic, so power3.out reaches half
  its travel at 0.159 × duration; a 0.4 s move starts 0.064 s early). The
  planner names the landing, never the start.
- **Bar timing:** new anchors `bar:<n>` and `bar:<n>.<beat>` (from
  `BEATS.json`). Sections start on bar lines. Cuts land on beats more often
  than chance, but not on every beat.

| Measure | Short motion (`short-motion`, `animated-explainer-reel`) | Short talking head | Explainer motion 20–180 s | Long form |
|---|---|---|---|---|
| Hook window | 0–3 s | 0–3 s | 0–4 s | 0–8 s |
| Events in hook (min) | 3 (profile `hook_events` p10) | 2 | 3 | 1 |
| Hook rate ÷ body rate (min) | 1.3 | 1.2 | 1.2 | 1.0 |
| Longest event gap after hook | warn 2.5 s, fail 5 s (`short-form` gap p90) | warn 6 s, fail 14 s (`talking-head`) | warn 3.5 s, fail 6.5 s | warn 10.5 s, fail 14 s (`long-form`) |
| `max_still` (frozen pixels) | 0.5 s (reel `longest_still_seconds` p90 0.43) | n/a (face moves) | 1.0 s | 3 s (existing `holds`) |
| Anticipation tolerance | ±1 frame | ±1 frame | ±1 frame | ±2 frames |
| Cuts on beat, when beat strength ≥ 0.3 | ≥ 0.6 and ≥ 1.8× chance | ≥ 0.4 | ≥ 0.5 | ≥ 0.3 |
| Cuts on every beat for 8+ beats | warn | warn | warn | warn |
| Pace change | 1 for 20 s and longer | 1 for 30 s and longer | 1 | 1 per chapter |

Fail lines sit inside today's `CADENCE_TARGETS`, so the new pressure comes
from the warn lines and the hook rule. A `calm` style stretches the seconds
×1.3, as `cadenceTarget` already does.

**Where:** `kit/core/pace-check.mjs` (plan side, frame-pure, findings in the
motion check's shape `{rule, severity, at, ids, detail}`), with the
anticipation rule added to `sceneMotionFindings` in `motion-check.mjs` because
it reads ops. Render side: `paceGate` in `src/quality_gates.js`, filed as
`pace` in `qa/finish/gates.json`, reading `hookEventSeconds` and stillness
from `src/render_motion_analysis.js` and beat data from §4.3. Profiles gain
`hook_rate_ratio`, `max_event_gap_seconds` and `cuts_on_beat_ratio` so a
measured reference set can tighten them.

### Built so far (phases 1 and 2, plan side)

What shipped, and where it departs from the text above:

- **Schema.** `treatment` is an optional, additive field of
  `launchclip.direction-map.v1`; no map changes shape, so the schema stays
  at v1 instead of moving to v2. `kit/core/treatment.mjs` validates it
  (`validateTreatment`, called from `validateDirection`). Without a
  storyboard (the planner's first call) only the shape is checked; against
  the storyboard every guardrail in the §1 table runs. The bespoke tier's
  first planner call requires `concept`, `throughline`, `banned`,
  `transitions` and `signature`; the storyboard check does not, so a drafted
  map still plans.
- **Not yet checked:** `concept` containing a verb (needs a tagger; the
  critic reads it), `throughline.object` as an element id inside each scene
  and the render-side carry check, `locked_example.check` expressions,
  `cover.frame` defaulting to the signature, and every `sound.*` field
  (later phase, with `bar:` anchors and the reference measures).
- **Banned tokens** with a plan check (`BANNED_CHECKS`): `crossfade`,
  `bounce-ease` (elastic, or back past 1.7), `camera-shake` (camera kicks or
  shake), `brand-before-end` (a logo, brand or wordmark module before 85%),
  `particles`, `lens-flare` (light-leak or flare), `hold>N`. A style pack's
  `avoid` list seeds `banned` in the prompt; without one it starts from
  `crossfade, bounce-ease, lens-flare`.
- **Pace bands** live in each `CADENCE_TARGETS` format as `pace`, scaled by
  the cadence style like the other seconds (the hook window does not
  stretch). Columns map to formats: short motion → `short-form`, short
  talking head → `talking-head`, explainer motion → `motion-graphics` and
  `art-direction`, long form → `long-form`. `animated` (character stories,
  not in the table above) gets hook 0–4 s with 2 events, ratio 1.2, gap warn
  6.5 s and fail 11 s (its `gap.p90_max`), max still 1 s. `paceFormat` picks
  the format: long form from 300 s or the long-form profile, then footage →
  talking head, the two reel profiles → short motion, a character profile →
  animated, else explainer motion.
- **Events** on the plan: each scene's entrance and transition moves, its
  states, hits and zooms, its module events, and each element that fades up
  from nothing or types on, merged within 0.25 s. Spans of playing footage
  or a travelling camera are opaque (their own events only show on the
  render): they never count as a gap, and a hook that is mostly opaque is
  left to the render. A closing `cta`, `end-card` or `brand-lockup` holds to
  the end without counting as a gap.
- **Severities on the plan.** `event-gap` fails past the fail line and warns
  past the warn line, as in the table. `slow-hook`, `flat-hook` and
  `frozen-frame` warn on the plan and fail only on renders (phase 7): a
  plan's element builds saturate the merged event rate (the hook ratio
  failed 28 of the 41 shipped examples), and a clip's or a still's own
  motion is only known in pixels. Six shipped examples open with fewer
  events than the hook rule asks (before-after, footage-transitions,
  overview-world, ui-parity, world-captions, zoom-through); they are
  single-feature parity fixtures, so they stay as they are. A frozen frame
  past a treatment's own `hold>N` fails on the plan.
- **Anticipation** is `late-beat` in `sceneMotionFindings`: a travel or
  scale tween that starts exactly on a state or hit and reaches half its
  travel more than one frame later. It warns, once per scene, until the
  compiler starts moves early (still to build); every shipped state move
  lands late today. The two-frame long-form tolerance waits for that too.
- **Gate:** `paceGate` in `src/quality_gates.js`, filed as `pace` in
  `qa/finish/gates.json`. The profile fields (`hook_rate_ratio`,
  `max_event_gap_seconds`, `cuts_on_beat_ratio`), cuts on beat, bar timing
  and the pace change rule wait for the beat data of §4.3.
  Phase 3 now measures tempo, beats and cuts on beat on references; the
  gate does not read them yet.

## 3. Techniques catalogue

Each line is our wording of a device that recurred across the long briefs.

| Technique | One line | Where it lives |
|---|---|---|
| Promoted throughline | One mark gets promoted through materials (sketch → plan → light) and never leaves | `treatment.throughline`, fluid-motion carry |
| Built from the last shot | Each scene's shapes, type and colour become the next; no cuts, no fades | `banned`, `morph` / `card-to-card` |
| Three inks | The same geometry redrawn in each world's material; the accent colour of one stage becomes the background of the next | style pack `inks[]` |
| Camera never rests | Every scene keeps a gentle push-in of 3 to 7 per cent, under everything else | ambient default for `short-motion`; pace `max_still` |
| One move per scene | One eased camera move a scene; never in-then-out back to back; never reverse | motion check rule `camera-reverse` |
| Zoom in log space | Interpolate scale as log(scale) so a 1→3× zoom moves at an even perceived speed | camera keys in `transitions.mjs` |
| Corner chrome | Small persistent labels (section name top-left, beat or step counter bottom-right) frame the whole film | overlay module `chrome` |
| Brand only at the end | The logo appears in the last beat; before that the hero object carries the colour | `banned: brand-before-end`, end card |
| One saturated colour | The hero object owns the only saturated hue; everything else is neutral | style `accent_budget: 1` |
| Colour withheld | Keep the hero colourless until the payoff, then hard cut to colour on the drop | `treatment.sound.drop` + state |
| Loop closes | The last frame equals the first, including cursor position and speed | `ending.loop_to` + render loop check |
| Transition demonstrates | The change of scene is itself the feature (a stream breaks and resumes) | `transitions[].demonstrates` |
| Text leaves first | Outgoing words are gone before incoming words take their place; text inside a morphing shape gets its own mask | `ghosting` gate text-overlap rule |
| Flood | A hard-edged shape grows past the frame's corners until it fills it, about 0.3 s with a soft start; it finishes before the next scene starts | new transition `flood` |
| Mask-line type | Letters rise one by one through a mask line; nothing pops in | `kinetic-words` default |
| Continuous rotation | Turn patterns smoothly, never a notch per beat; pick a speed that lands on the start at the loop | `fluid-motion.mjs` |
| Stretching edges | A sliding indicator's leading edge rides a faster spring than its trailing edge | `fluid-motion.mjs` `stretchOps` |
| Critically damped spring | 1 − (1 + ωt)e^(−ωt), ω 12–40, one term per target change; never overshoots | grammar ease `spring(ω)` |
| Stagger on the grid | Stagger = a sixteenth note (0.125 s at 120 BPM) | `grammarStagger` from bpm |
| Misregistration | A 2–4 px colour-split copy only on impact frames | hit effect `misregister` |
| Counters keep running | Counters read the film's clock, keep running through cutaways, never freeze | count-up modules |
| Action → result | Every action shows a consequence: a scan finds things, a tap makes a new state | direction-map rule on `process` lines |
| Match cuts only | Cut hard only when the shot on each side has the same subject, scale and direction of movement | transition check |
| Vary the scale | Close, wide, overhead, full-frame type; never the same layout twice | `variety` gate |
| Phrase cue sheet | Spoken-word pieces time to phrases and pauses, not to a dance beat | `timing: "phrase"` vs `"bar"` |
| Earned stillness | The first perfectly level moment, held 0.4 s, after a stretch of tension | `treatment.sound.breath` |
| Pop scan | Find single-frame jumps: a frame difference 3× both neighbours | `render_motion_analysis.js` `pops` |
| Smaller rules | Grow a dot into a window rather than zooming into it; ease an iris by area; one scan line can swap worlds; reset hidden parts while something covers the frame; a glitch is 1–2 frames on a real cut; the picture keeps moving through narration pauses; one still per beat before the full render | `transitions.mjs`, loop ending, pace gate, prototype step |

## 4. Reference measurement upgrades

All four read the small grey frames we already decode, add profile fields,
and run on our own renders in `finish`, where we know the truth (planned
transitions, eases, cues), so planned-vs-measured is itself a check.

### 4.1 Transition classifier

Replaces the guess in `grammarFromPacing`. Per boundary:

1. **Crop borders.** Sample 48 frames; a row or column is picture when > 8% of
   its pixels vary by > 16 levels. Skip the crop when what is left is under 15%
   of the height or 30% of the width.
2. **Find gradual boundaries** (no hard cut). For window lengths 0.2, 0.35,
   0.6, 1.0 and 1.5 s, slide in steps of a fifth of the window. Keep a window
   when its two ends differ (mean abs diff ≥ 10 on a 12×16 thumb), the picture
   is steady just outside (change outside ≤ 0.3 × change across), ≥ 50% of an
   8×6 block grid changed, the change is not explained by a warp (block-motion
   residual after warp < 0.45 × before), and progress (0 = old frame, 1 = new
   frame, by distance ratio) stays < 0.3 before and > 0.7 after. Tighten to
   where progress crosses 0.12 and 0.88.
3. **Span of a hard cut.** Widen around the cut over frames that change
   faster than 2.5× the shot's median change, or lose detail below 0.6× its
   median gradient, up to 1.5 s.
4. **Classify** (first match wins):

| Kind | Test |
|---|---|
| fade (via black/white) | a middle frame is flat (std < 8) and its mean < 45 or > 210 |
| flash | span ≥ 0.15 s; peak mean > 170 and > both ends + 50 |
| cut | a detected hard cut whose span < 0.25 s |
| iris | blocks turn old→new once each; turn time correlates with radius, \|r\| ≥ 0.55 |
| wipe / push / cover / reveal + direction | a straight edge composite at 33 positions × 4 directions explains the middle frames: median residual ≤ 0.25 and < 0.6 × the blend residual; edge position rises (r ≥ 0.8) and travels ≥ 0.3 of the frame. A moving mode must beat `wipe` by 20% |
| spin | summed rotation ≥ 25°, net turn ≥ 0.7 of it |
| zoom | summed \|log scale\| ≥ 0.5 |
| whip + direction | net travel ≥ 0.3 frame, path < 1.5 × net, sharpness < 0.7 |
| shake | path ≥ 0.4 and > 3 × net |
| blur | detail < 0.5 both sides of the switch |
| dissolve | frame ≈ A + α(B − A), residual < 0.25, α rising (r > 0.85) |
| glitch | the picture swings back towards the old shot ≥ 2 times |

For per-pair shift, scale and rotation the source fits a similarity transform
to tracked features; we reuse `globalMotion` and `analyzeZoom` in
`render_motion_analysis.js`. Map to our types: dissolve →
`fade`, wipe → `dot-wipe`/`glow-wipe`, iris → `iris`, slide push → `push`,
flash → `light-leak`, blur → `rack-focus`, zoom → `zoom`/`push-blur`.

Profile fields: `transitions_per_min`, `transition_mix` (shares by kind),
`transition_seconds` (p50). `grammarFromPacing` then reads `transition_mix`
and falls back to shot length only with no data. On our renders: planned type
vs classified type, ≥ 80% agreement or a `transition-intent` warning listing
the mismatches.

#### Built so far (phase 4, transition classifier)

What shipped, and where it departs from the text above:

- **Code.** `classifyTransitions`, `pictureCrop`, `analyzeTransitionsFile`
  and `transitionStats` in `src/render_motion_analysis.js`, every
  threshold in `TRANSITION_CLASSIFY`. `TRANSITION_TYPE_KINDS` gives the
  kind each of our types draws; `KIND_TRANSITION_TYPES` maps a measured
  kind back to our types for the style drafter.
- **Grids.** The file reader decodes twice: 48 frames at 640 px on the long
  side find the crop (rounded inward, so no bar bleeds in), then ffmpeg
  crops the picture and scales it straight to a work grid with a 48 px
  short side at 30 fps, so a letterboxed copy is read from the same
  pixels. Distances use a 12×16 thumb and a 6×8 block grid of that grid.
- **Boundaries.** "Just outside" is a quarter of the window (at least two
  frames). Overlapping windows are grouped by their tightened spans, not
  the windows (a 1.5 s window reaches the next boundary), and the widest
  wins: a cover through a held dark frame also passes as old → dark and
  dark → new. The warp check searches five scales and shifts up to 30% on
  a half-size grid. Step 3 (widening a hard cut's span) is not built: a
  cut is one frame pair jumping from progress ≤ 0.12 to ≥ 0.88 inside a
  span under 0.25 s, because an eased push is as short but passes through.
- **Kinds.** The flat-frame test uses 1.4826 × the median absolute
  deviation, not the std, so sparks and light streaks over a dark cover
  still count. A new `dip` via `pattern`: a middle frame at least 1.2× the
  A–B change from both pictures (a halftone grid; glow-wipe peaks at 0.98).
  The edge composites take one gain per frame when it lowers the residual
  (glow-wipe's flare, push-blur's exposure dip), the residual limit is 0.35
  (not 0.25; orbit and the pans with a gap sit at 0.27–0.33, the blend test
  still rules out dissolves), and cover or reveal must beat push by 20% as a
  moving mode must beat wipe (near ties flipped between renderers). A slide
  whose sharpest middle frame has under 0.7 of its composite's detail is a
  whip; a smeared "wipe" goes on to the motion tests. Shift, scale and
  rotation come from block matching on the work grid and a similarity fit,
  not `globalMotion`/`analyzeZoom` (fixed grids, another decode). Zoom is
  a net |log scale| ≥ 0.25 that is at least 0.4 of the summed one (the RFC:
  summed ≥ 0.5): per-pair fits over two blended pictures are noisy, and our
  zoom (in 0.6 → 1, out 1 → 1.5) nets 0.31.
- **The RFC test** (`test/transition_classifier.test.js`, a media test):
  every type but `overview` between two footage stills at 360×640, cuts
  mode, both renderers: 27/28 right in each (96%); `whip-pan` reads as a
  push (its blur lasts two frames at 48 px). Pillarboxed and letterboxed
  copies give the same kind for every boundary. All nine VFX covers,
  `dot-wipe` and `light-sweep` cover the frame at their midpoint and read as
  dips (black, or pattern for the halftone), so the RFC's "wipe →
  dot-wipe" becomes "dip"; `push-blur` travels with a smear and reads as a
  whip; between footage `morph`, `rack-focus` and `card-to-card` play as a
  fade and read as dissolves (blur is untested on our types). In
  `camera.mode: world` a push is a dolly and reads as zoom. Analysis takes
  about 5 s for 46 s of video.
- **Profile fields** land in each reference's `pacing` (with the list of
  `transitions`) and, averaged, in `reference_stats.pacing`.
  `grammarFromPacing` orders `transition_preference` by the measured mix
  (kinds with at least a tenth, first three types) and keeps the shot-length
  guess for the grammar and for no data. `finish`'s style gate skips the
  pass.
- **Not yet built:** planned type vs classified type on our renders and the
  `transition-intent` warning (phase 7). Spin, shake, blur and glitch have
  thresholds but no type of ours draws them cleanly, so they are untested.

### 4.2 Per-element entrances

Decode at 180 px wide, ≤ 15 fps; 4 px cells. A pixel changed when any channel
moves > 12; a cell is active when > 12% of its pixels changed. Cells active
> 70% of a shot (or changing > 8 levels over 1 s in > 60% of samples) are the
**continuous layer** (drift, glow); report its share and box. Group the rest
into events by connected cells, split where start times jump > 0.12 s; drop
events under 0.2% of the frame.

- **Ease:** cumulative activity at the event's half-life: > 0.68 → ease-out,
  < 0.32 → ease-in, else coefficient of variation < 0.45 → linear, else
  in-out.
- **How it enters:** active tip < 35% of the area and start time correlating
  with x or y (\|r\| > 0.6) → draw-on/wipe with direction; centroid travel
  > 2% → slide with direction; first-frame width < 0.6 × final → scale.
- **Stagger:** ≥ 3 events of the same kind, sizes within 40%, durations
  within 50%, start gaps with std ≤ 0.4 × mean → a sequence with `interval`
  and per-item duration. Touching pieces that start as the last ends join
  into one draw-on.

Profile fields: `entrance_seconds` (p50), `stagger_interval_seconds` (p50),
`entrance_ease_mix`, `entrance_kind_mix`, `continuous_layer_share`. The style
drafter sets `motion.grammar.duration.enter`, `stagger` and `ease.enter` from
them. On our renders the measured ease must match the grammar's role; an
ease-in measured on an entrance is the `entrance-ease` rule, caught from
pixels when the ops missed it (a custom module).

### 4.3 Tempo, beats, SFX and sync

STFT at 22,050 Hz, n_fft 1024, hop 256 (11.6 ms). Harmonic/percussive split by
median filters of 17 along time and along frequency, with soft masks
H²/(H² + P²).

- **Onset curve:** positive first difference of log(1 + Σ percussive).
- **Tempo:** autocorrelate the mean-removed curve; pick the peak lag between
  60/190 and 60/60 s; under 75 BPM double it. `beat_strength` = normalised
  autocorrelation at the lag. No beat when the 90th-percentile percussive share
  < 0.045 and strength < 0.2.
- **Grid:** pick the phase whose comb sums most onset energy, then snap each
  beat to the local onset peak within ±3 hops.
- **SFX:** onset peaks ≥ 60 ms apart whose strength (onset ÷ local 90th
  percentile over ±1 s) ≥ 3, louder than peak − 30 dB, outside speech, ≥ 6
  under music, not within 50 ms of a beat. Type from the 120 ms after onset:
  decay = time to fall 15 dB; `hf` = share above 4 kHz; centroid; tonality =
  max/mean bin.

| Type | Rule |
|---|---|
| whoosh | decay > 0.25 s and hf > 0.25 |
| ding | tonality > 25 and centroid > 1,200 Hz |
| impact | centroid < 350 Hz |
| click | decay < 0.06 s and hf > 0.3 |
| pop | hf > 0.2 or tonality > 15 |
| typing | ≥ 4 click/pop/hit within ±0.6 s |
| hit | otherwise |

- **Sync:** an SFX within 0.12 s of a cut or visual event is on-picture. A cut
  within 0.07 s of a beat is on-beat; chance = beats per second × 0.14; an edit
  is beat-synced with ≥ 4 cuts and an on-beat share > max(0.5, 1.8 × chance).
- **Sections:** chroma and loudness novelty comparing the 4 s either side; the
  strongest is the drop candidate for `treatment.sound.drop`.

The types match our SFX families, so a measured mix maps straight onto
`sfx_density` and family weights. A radix-2 FFT and median filter go in
`kit/core/sound/dsp.mjs` (no dependency).

Profile fields: `tempo_bpm`, `beat_strength`, `cuts_on_beat_ratio`,
`cuts_on_beat_lift` (ratio ÷ chance), `sfx_per_min`, `sfx_mix`,
`sfx_on_picture_ratio`, `near_silences_per_min` (gaps ≥ 0.4 s at ≤ peak −
30 dB). `soundFromAudio` uses them instead of the transient count alone. On
our renders, `src/render_audio_analysis.js` already knows every planned cue:
each must be detected within 0.05 s with the planned type in ≥ 70% of cues,
and silences and pre-laps from the treatment are measured where they were
planned.

#### Built so far (phase 3, audio port)

What shipped, and where it departs from the text above:

- **Code.** `analyzeRhythm`, `analyzeRhythmFile`, `speechSpans`, `sfxType`
  and `rhythmSync` in `src/render_audio_analysis.js`, with every threshold
  in `AUDIO_RHYTHM` and `SFX_TYPE_RULES`. The FFT and the median-filter
  split are not a new `kit/core/sound/dsp.mjs`: they are the ones
  `AUDIO_FEATURES.json` already uses (`fft` and the newly exported
  `percussiveSpectra` in `src/scripts/audio-features.mjs`). Decoding reuses
  `decodeAudio` from `src/music/beats.js`.
- **Grid.** The comb searches the period within ±2% of the autocorrelation
  lag (0.05% steps) as well as the phase, because one onset hop is 1.3% of a
  150 BPM beat. An onset frame's time is its window start plus 37.5 ms,
  measured on clicks.
- **No beat** when the 90th-percentile percussive share is under 0.045
  **or** the strength is under 0.3 (the text says "and", at 0.2). Speech has
  a percussive share near 0.8, so "and" gave narration a beat, and a dozen
  irregular keystrokes in silence reach 0.22. Click tracks sit at 0.55–0.65.
- **Speech** for "outside speech" comes from the caller (`options.speech`)
  or from `speechSpans`: voiced frames (80–400 Hz autocorrelation ≥ 0.5 with
  the window's own autocorrelation divided out, half the energy under 1 kHz)
  merged into phrases of ≥ 3 runs, ≥ 0.6 s and ≥ 30% voiced, padded 0.2 s
  for consonants. On two narration files it leaves 13 and 6 false SFX per
  minute (from about 100); an SFX under the voice is not counted, as the
  rule says, so a narrated reference under-reports its SFX.
- **Types.** Our kit is band limited (most families keep under 5% of their
  energy above 4 kHz), so rea-video's brightness tests never fired on our
  whooshes and clicks. Click is tested first and also accepts a centroid
  over 550 Hz, with decay under 0.08 s; whoosh also accepts "noisy and
  sustained" (decay > 0.18 s, tonality < 15); ding's centroid floor is
  1 kHz. Tonality is max/mean of the magnitude, not the power, spectrum.
  `SFX_FAMILY_TYPES` gives each family its expected type (null for riser,
  tally, tape-stop, glitch, error-buzz and pen-scribble). Measured on each
  variant alone: default kit 86% (the test), minimal 78%, glassy 77%,
  organic 55% (its dings and keys are marimba-like, under 1 kHz). Boing
  measures as impact and a space bar as impact in every palette.
- **Two rule sets.** The immersive sound RFC's classifier
  (`src/sfx/classify.js`, merged alongside this) types one isolated file
  with rea-video's thresholds unchanged and its own family table
  (`FAMILY_TYPE`); this scan shares its `SFX_TYPES` and `typingRuns` but
  keeps the recalibrated rules above and `SFX_FAMILY_TYPES`. Its baseline
  types our clicks and keys as ding in every palette, which is what the
  recalibration fixes. One table and one rule set is a follow-up.
- **Profile fields** land in each reference's `sound` and in
  `reference_stats.sound`: all eight from the list above plus
  `beat_synced`. `soundFromAudio` sets `sfx_density` from `sfx_per_min`
  when measured, split at 15 and 24 per minute (the midpoints of `finish`'s
  cue pace: 12, 18, 30), and a measured tempo sets `sound.music.bpm_range`
  (±3 BPM) and counts as music present. `finish`'s own style check skips
  the rhythm pass.
- **Not yet built:** sections and the drop candidate, planned-vs-measured
  cue checks on our renders (phase 7), and the `bar:` anchors and cuts-on-
  beat pace rules that consume this (phase 2's render side). With a voice
  over the music the beat is usually lost (strength 0.11–0.17 on our
  example mixes); a music stem, when there is one, measures cleanly.

### 4.4 Calm-moment cut scoring

For trimming footage, Shorts from a long form, and `finish`'s cut snap
(today the nearest downbeat within 0.25 s, motion ignored).

1. Motion curve at 12 fps, 160 px grey: mean absolute change from the previous
   frame, overlay boxes masked out, 3-tap moving average.
2. For each wanted cut at `target`, search ±30% of the segment length, within
   the segment's min and max.
3. Score each sample t: `e(t) / p90(e) + 0.4 × min(1, |t − nearest beat| /
   beat) + 0.3 × |t − target| / step`. An existing source cut scores
   `0.1 + 0.3 × |c − target| / step` (a free seam). Lowest wins; tag it
   `cut`, `beat` (beat term < 0.25) or `calm`.

On our renders: the score of each planned cut against the motion curve. A cut
scoring > 1.2 (mid-move, off the beat) warns as `cut-mid-motion`.

## 5. Phases, effort and tests

| Phase | Work | Effort | Tests |
|---|---|---|---|
| 1 | `treatment` block: schema, `validateDirection` checks, `treatmentLines()`, style `avoid` tokens | M, 2 PRs | One test per field: pass and fail fixtures; `banned` token → check mapping table test; prompt snapshot |
| 2 | `pace-check.mjs`, `bar:` anchors, anticipation start offsets in the compiler | M, 2 PRs | Beat maps with a slow hook, a 6 s gap, a late hit; ease half-travel table test; anchor parsing |
| 3 | Audio port: FFT, HPSS, tempo, grid, SFX typing, sync | L, 2 PRs | Click tracks at 90/120/150 BPM with ±10 ms jitter: tempo within 1 BPM, beats within 20 ms. Our own synthesized families → types ≥ 80% right. Speech-only fixture → no beat |
| 4 | Transition classifier | L, 2 PRs | Render each of our `TRANSITION_TYPES` both renderers; confusion matrix ≥ 85% on the mapped kinds; letterboxed copies give the same answer |
| 5 | Entrances, eases, stagger | M | Fixtures with known eases and staggers from our own ops: ease role right ≥ 85%, interval within one frame |
| 6 | Calm-cut scoring in `finish` snap and Shorts-from-long-form | S | Synthetic motion curve: picks the trough; respects min/max; prefers a source cut |
| 7 | Pace gate on renders, planned-vs-measured checks, re-measure shipped profiles | M | `eval:formats` scorecard gains the new columns; profile provenance regenerated |

Every port keeps the source's thresholds as named constants in one frozen
object (the `MOTION_CHECK` pattern), each with a one-line reason.

## 6. Provenance

| Item | Source path | Licence | Use |
|---|---|---|---|
| Transition finder and classifier (§4.1) | `rea-video/src/rea_video/transitions.py` | Apache-2.0 | port (keep NOTICE, credit in file header) |
| Per-element events, ease, stagger (§4.2) | `rea-video/src/rea_video/motion.py` | Apache-2.0 | port |
| HPSS, tempo, beat grid, SFX typing, cut sync (§4.3) | `rea-video/src/rea_video/audio.py` | Apache-2.0 | port |
| Calm-moment cut scoring (§4.4) | `rea-video/src/rea_video/drive.py` `cut_points` | Apache-2.0 | port |
| Silences before the turn, J/L cuts, pace variation, one signature shot, reading time | `lemo-opuscar/src/DIRECTOR.md` §6–8 | CC BY-NC 4.0 | rewrite (ideas only) |
| One timeline drives picture, music and checks | `lemo-opuscar/src/TECHNIQUE.md` §3 | CC BY-NC 4.0 | rewrite (ideas only) |
| Single-accent rule, draw-on order, mechanisms stepping on the grid | `lemo-opuscar/src/styles/*/STYLE.md` | CC BY-NC 4.0 | rewrite (ideas only) |
| Catalogue rows in §3 and the treatment fields in §1 | `awesome-opus/data/videos.json`: heyiamnick-119558, twoclipping-551116, -747965, -496100, -041659, -402193, thegrootdev-966114, morse-369333, notdwd-998633, brainextends-606193, techhalla-498547, howdevelop-733090, ultimaxbt-549714, everestchris6-399895, gdgtify-929495, -130294, -393073 | list MIT; prompt text belongs to each poster | rewrite (ideas only, no prompt text kept) |
