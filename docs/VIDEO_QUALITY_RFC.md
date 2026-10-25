# RFC: Measured quality for every kind of video

Status: draft, open for review
Date: 2026-10-25
Builds on: [STORYBOARD_ENGINE_RFC.md](STORYBOARD_ENGINE_RFC.md),
[SUBJECT_EFFECTS_RFC.md](SUBJECT_EFFECTS_RFC.md),
[KIT_CONTRACTS.md](KIT_CONTRACTS.md) (style packs, gates, footage-led lane)

## 1. Summary

LaunchClip can make a video that passes every check and is still not good.
The first real skill-path run on a founder's own footage (a 4-minute Ship Mode
talking head) showed it: the layout, loudness, audio, evidence and subject
gates passed, and the founder's verdict was "not great: way more opportunities
for visualisations were missed, and generally the style is a bit off".

The cause is structural, not one bad plan. Quality today rests on fixed rules
someone picked ("dress 10–40% of the runtime", "first motion by 0.35 s"),
loud generic defaults, a small text-heavy module library, and checks that
measure mechanics but not taste or coverage.

This RFC replaces that with one principle: **measure what good looks like,
plan to it, and verify the render against it.**

1. **Cadence profiles** measured from reference sets of strong videos, per
   format and platform. Ranges, not single numbers. The planner plans to them
   and the gates measure renders against them.
2. **A direction map** for every story: each line gets an intent and a visual
   decision. Coverage becomes a result of the map, checked against the
   profile, instead of a cap in a prompt.
3. **Layouts** for footage, held per section: full frame, presenter on a
   third beside a panel, presenter framed small, full-frame insert. The face
   is tracked for the whole video, not only where a matte exists.
4. **A larger visual vocabulary**: concept cards, brand-tinted icons, simple
   illustrated objects, excerpts, comparisons, timelines, quote and stat
   cards, chosen by intent.
5. **A style system** that carries layout rules, vocabulary choices, captions,
   motion grammar, cadence profile and a brand frame. Customisation is a few
   high-level dials inside measured ranges, plus component overrides.
6. **A quality loop that judges taste**: a prototype of the opening first,
   candidates on risky beats, and a critic whose rubric includes missed
   opportunities and compares frames against the reference set.

Users can override pacing, but never have to. Defaults come from what works,
and later from real retention data when a user connects it.

## 2. What the Ship Mode run showed

The run followed the skill's recorded-video route end to end. These are the
findings that generalise.

| Finding | Where it comes from |
|---|---|
| 15 scenes in 144 s; the face full-frame almost throughout | The footage-led planner rule: "overlays and inserts on the strong lines only, covering 10–40% of the runtime… gaps show the recording" (`planning-prompt.mjs`, `storyboard-modules.md`) |
| Subject effects capped again | The subject density budget (at most 35%, one or two per 30–60 s) stacked on the 10–40% rule |
| Only two ways to show anything: a small overlay, or a full insert that hides the presenter | No footage layout that holds across a section |
| Text cards and checklists where the approved reference had illustrations, code excerpts and a calendar card | 32 modules, mostly text and UI panels; no icon or illustration set |
| ALL-CAPS captions that fought every overlay | The `word-highlight` preset ("bold uppercase chunks") is the default in every lane |
| Each graphic stood alone | No brand frame (logo kicker, section label, progress) across scenes |
| Checklists drawn over the presenter's head | The face is known only inside matted ranges, so placement and layout-check had no head elsewhere |
| The motion gate failed a locked-off talking head | One flow-velocity floor (2 px/s at p90) for every lane |
| The critic flagged polish, not sparseness | The rubric has no "missed opportunity" or coverage dimension |

The founder's approved reference video, made by hand, dressed almost every
line: a split layout, a branded kicker, illustrations, code excerpts and quiet
sentence-case captions. It is evidence of what "good" means for that brand. It
is not a template: the goal is a system that gets there for any brand.

## 3. Goals and non-goals

Goals:

- Every format gets measured targets for pacing, coverage and face time, with
  ranges that come from strong references.
- Every story has a direction map, a visual decision per line, produced by both
  the headless planner and the skills.
- Footage gets layouts, whole-video face tracking and a vocabulary rich enough
  that "dress this line" always has a good answer.
- A style carries enough to make two videos in it look related, and a gate
  fails a render that drifts from it.
- Users customise through a few dials and overrides; nobody has to tune
  pacing.
- The critic and the gates catch a sparse or off-style draft before the user
  sees it.

Non-goals:

- Copying any reference video's frames, layout or assets. References are
  measured; only numbers are kept (section 5.4).
- Replacing the renderers, the storyboard contract or the module model. Every
  addition is a module, a field or a gate.
- A user-facing timeline editor. Editing stays in chat, the storyboard and the
  NLE exports.
- Training models. Profiles are statistics over measurements.

## 4. The principle: measure, plan, verify

Each of the three steps gets one artifact:

| Step | Artifact | Who writes it |
|---|---|---|
| Measure | `launchclip.cadence-profile.v1` (per format and platform; section 5) | The reference pipeline, shipped with the package; a style can carry its own |
| Plan | `DIRECTION.json`, `launchclip.direction-map.v1` (per story; section 6) | The planner (`make`, `story plan`) or the agent (skills) |
| Verify | `qa/quality/*.json`, gate results (section 11) | `finish`, `cinematic-check`, `style check` |

The storyboard stays the source of truth for what renders. The direction map
says why each scene exists. The profile says what the whole should measure
like.

## 5. Cadence profiles

### 5.1 What a profile holds

A profile is ranges (p10, p50, p90) over measurements of a reference set:

```json
{
  "schema": "launchclip.cadence-profile.v1",
  "id": "youtube-talking-head-launch",
  "format": "footage-led", "platform": "youtube", "aspect": "16:9",
  "duration_seconds": [60, 240],
  "references": 24,
  "measures": {
    "shot_seconds":            { "p10": 1.6, "p50": 3.8, "p90": 9.5 },
    "visual_changes_per_min":  { "p10": 9,   "p50": 16,  "p90": 26 },
    "coverage":                { "p10": 0.45, "p50": 0.68, "p90": 0.86 },
    "face_time":               { "p10": 0.55, "p50": 0.72, "p90": 0.9 },
    "longest_undressed_seconds": { "p50": 6, "p90": 11 },
    "first_visual_seconds":    { "p50": 0.4, "p90": 1.2 },
    "text_hold_seconds":       { "p10": 1.2, "p50": 2.4, "p90": 4.5 },
    "caption_words_on_screen": { "p50": 3, "p90": 6 },
    "flow_velocity_p90":       { "p10": 0.0, "p50": 1.1, "p90": 3.0 },
    "layout_changes_per_min":  { "p50": 2.5, "p90": 5 }
  }
}
```

The numbers above are placeholders for the shape, not measured values. Phase 1
measures them.

### 5.2 Measurements

Most of these already exist in some form:

- **Pacing:** cuts and shot lengths, hold ratio and change energy
  (`src/render_motion_analysis.js`, `src/style_reference.js`).
- **Captions:** band position and density (`style_reference.js`
  `detectCaptions`).
- **Sound:** loudness, silence ratio, transients (`style_reference.js`).

New:

- **Coverage:** the share of the runtime with a designed graphic on screen.
  For LaunchClip renders this comes exactly from the resolved storyboard. For
  references it is estimated from persistent non-footage regions and text
  bands.
- **Face time:** the share with the presenter's face visible (face detection
  over sampled frames; the probe model is enough).
- **Longest undressed run:** the longest stretch with no graphic.
- **Layout changes:** switches between full frame, split, framed and insert
  layouts.

### 5.3 Profiles shipped

One per format and platform pair, starting with:

| Profile | Format | Platforms |
|---|---|---|
| `short-talking-head` | footage-led, ≤ 60 s, 9:16 | Shorts, Reels, TikTok |
| `short-motion` | motion, ≤ 60 s, 9:16 | Shorts, Reels, TikTok |
| `youtube-talking-head-launch` | footage-led, 1–5 min, 16:9 | YouTube, landing pages |
| `youtube-long-form` | footage-led, 5–30 min, 16:9 | YouTube |
| `explainer-motion` | motion and voiceover-motion, 30–180 s | any |
| `product-demo` | demo-led, 30–120 s | any |

The profile is chosen from the routed lane, aspect, duration and platform,
which `make` and the skills already know.

### 5.4 Reference provenance

- References are videos we have the right to analyse: our own, licensed, or
  public videos analysed for statistics only.
- Only measurements are stored, never frames, audio or text.
- Each profile lists its sources in a provenance file, as
  `THIRD_PARTY_NOTICES.md` does for bundled dependencies.
- Users add their own references with
  `launchclip style create --from-reference`, which already measures pacing,
  captions and sound. Their style then carries a profile measured from their
  own best videos (section 9.4).

### 5.5 How profiles are used

- **Planning:** the planner receives the profile's p50 targets and the band
  between p10 and p90, plus the direction map's per-line needs (section 6).
- **Checking:** the gates measure the render and compare it with the band
  (section 11).
- **Adapting to content:** the band is fixed, but the target within it moves
  with content. A dense list section aims high on coverage, and a personal
  story aims high on face time. The direction map records why.

## 6. The direction map

### 6.1 Contract

`DIRECTION.json` sits beside `storyboard.json`:

```json
{
  "schema": "launchclip.direction-map.v1",
  "profile": "youtube-talking-head-launch",
  "sections": [
    { "id": "s1", "title": "The problem", "start": 0, "end": 31.2, "layout": "split-right",
      "lines": [
        { "words": [0, 23], "intent": "claim", "treatment": "dress", "scenes": ["die"], "why": "three parallel claims; one visual per claim" },
        { "words": [24, 43], "intent": "problem", "treatment": "dress", "scenes": ["build-properly"] },
        { "words": [44, 52], "intent": "personal", "treatment": "face", "why": "the turn lands on his face" }
      ] }
  ]
}
```

- **Intents:** `hook`, `claim`, `problem`, `turn`, `proof`, `number`, `list`,
  `process`, `product`, `personal`, `quote`, `cta`.
- **Treatments:** `dress` (a visual alongside the presenter), `insert` (a
  full-frame visual over the voice), `face` (hold on the presenter on purpose),
  `camera` (a punch-in or camera move only).
- **Lines:** inclusive word ranges in the story's narration words, so the map
  survives re-timing.

### 6.2 Rules

- Every line has an entry. A line with `face` or `camera` treatment needs a
  short `why`; `dress` and `insert` lines name their scenes.
- Validation checks that every line is covered and that the scenes it names
  exist and overlap the line's words.
- **Coverage, face time and the longest undressed run are computed from the
  map and the storyboard** and checked against the profile band. This
  replaces the "10–40%" prompt rule and joins the subject density budget,
  which becomes a profile measure instead of a fixed cap.

### 6.3 Who writes it

- **Headless:** `story plan` and `make` ask the model for the direction map
  first (one structured call), then the storyboard against it. The repair loop
  repairs both.
- **Skills:** the recorded-video and new-story workflows write the map before
  the storyboard, as the "whole-transcript direction map" step already
  describes. `story validate` now requires it in the footage-led and motion
  lanes.
- **The intent classifier** is shared: the phrase table in
  `planning-prompt.mjs` grows into intent rules (lists, numbers, product
  names, turns, calls to action), so both paths classify the same way
  (`subject_paths.test.js` is the model for the parity test).

## 7. Footage layouts

### 7.1 Layouts

A section has one layout; scenes inside it render within it.

| Layout | Presenter | Graphics area |
|---|---|---|
| `full` | full frame | overlays only (today's behaviour) |
| `split-left` / `split-right` | reframed onto one side (about 42–50% of the width) | a branded panel on the other side, held for the section |
| `framed` | inset in a rounded frame | the rest of the canvas |
| `stacked` (9:16) | top or bottom half | the other half |
| `insert` | hidden; voice continues | full canvas |

- The presenter is reframed with the base camera, which already exists
  (`subjectCameraOps`, punch-in). With a matte, the room can also be dimmed
  or replaced behind them (the `room` field).
- A layout change is a typed transition (`layout-shift`), so evidence and
  boundary checks see it.
- Panels inherit the style's brand frame (section 9.2).

### 7.2 Whole-video face tracking

The probe samples about one frame per second today, and head and body boxes
exist only inside matted ranges. That left layout-check blind outside them in
the Ship Mode run.

- A **track pass** (`launchclip subject track`, also run by `make`) writes a
  head and body box per frame at 10 fps for the whole base, using the probe
  model. It's cheap and cached.
- `subjectContext(story, t)` reads the track when no matte covers t, so module
  placement and the face rule work everywhere.
- Mattes stay per range, only where depth is needed.

## 8. Visual vocabulary

New catalogue modules, chosen by intent. Each one ships with both renderers,
parity fixtures, phrase or intent rules, and honesty rules.

| Module | For intent | What it draws |
|---|---|---|
| `concept-card` | claim, problem, turn | a big word or short phrase, an icon and a sub-line |
| `icon-row` | list, process | 2–5 icons with labels that build on their words |
| `stat-card` | number | a figure with a label and source line (real figures only) |
| `quote-card` | quote, proof | a real quote with attribution (real only) |
| `compare` | claim | before and after, or two columns |
| `timeline` | process | steps along a line, built on their words |
| `excerpt` | proof, product | a code or text excerpt with highlights (real content only) |
| `object-card` | product, claim | a simple illustrated object from the icon set, with a caption |
| `section-card` | section starts | the brand frame's kicker and a section title |

The **icon set** is a single in-repo line-icon family, drawn as SVG paths,
tinted by the style, with stable names so the planner can pick
`icon: "shield"`. It starts at about 120 icons and holds to one stroke weight
and corner radius so mixed icons look like one set. Third-party icon sets are
used only under compatible licences, listed in `THIRD_PARTY_NOTICES.md`.

**Illustrated objects** are composed from the icon set plus brand shapes
(for example a boat, a box or a calendar), not drawn per video.

## 9. The style system

### 9.1 What a style carries

`launchclip.style.v3` extends v2 (colours, fonts, captions, grammar, ambient,
sound, module preferences) with:

- **Layout rules:** preferred layouts per intent and section (for example
  split-right for list sections), panel treatment (solid, glass or paper),
  and corner radius.
- **Vocabulary choices:** the icon tint, illustration on or off, and preferred
  modules per intent (generalising `modules.prefer` and `avoid`).
- **A cadence profile:** a reference to a shipped profile, or one measured
  from the user's references.
- **The brand frame:** a logo, a kicker style, section labels, a progress
  indicator, and where each appears.
- **Caption defaults per lane:** footage-led defaults to a quieter
  sentence-case preset with one accent word. `word-highlight` stays available.

v2 packs keep working; an upgrade fills the new fields from defaults.

### 9.2 Brand frame

The frame is drawn by the compiler around scenes, not by each module.

- A section's panel shows the kicker (the logo plus a short label, for
  example "Inside Ship Mode") and its underline.
- Inserts and cards show it in their chrome.
- An optional progress line runs along the bottom edge.

Modules receive the frame's safe area so they never collide with it.

### 9.3 Dials and overrides

Three layers, from simplest:

1. **Pick a style** from the library (the starters, plus styles drafted from
   references).
2. **Turn a few dials**, each 0–1:
   - `energy`: shot length, transition rhythm, motion grammar intensity;
   - `density`: where the target sits inside the coverage band;
   - `playfulness`: vocabulary and mood choices;
   - `polish`: ambient motion, texture, blur.

   **Dials move targets within the profile's measured band; they cannot leave
   it.** That is what keeps customisation from producing something that
   doesn't work.
3. **Override components:** one module's look, a colour, a caption preset, a
   layout for one section. Overrides are validated like any storyboard field.

A full custom style remains possible for brands that need it.

### 9.4 Styles from references

`launchclip style create --from-reference` already drafts a pack from
previous videos. It grows to also produce:

- a cadence profile measured from those videos;
- the layout mix, estimated from persistent panel regions;
- the caption treatment, estimated from text bands and case.

This is a starting point that the user reviews, not a copy: only measurements
and colour clusters are kept.

### 9.5 Adherence

`launchclip style check <project> --against <style>` exists. It becomes a
`finish` gate when the story names a style. It checks:

- the palette in the render;
- caption treatment;
- the layout mix;
- that the cadence measures sit inside the style's band;
- that the brand frame is present where the style says.

## 10. By format

### 10.1 Shorts (≤ 60 s, 9:16)

- Short profiles: a visual by about 1 s, a visual change every 1.5–3 s
  (measured, not fixed), high coverage, and a loop ending.
- Layouts: `full` with overlays, `stacked`, and inserts. No `split`.
- The hook is a visual plus words in the first 1–2 s, chosen by the direction
  map's `hook` line, not a lone zoom.
- Existing delivery rules stay: the safe zone, −14 LUFS, centred
  captions.

### 10.2 Long form (5–30 min)

- **Structure before density:** chapters from the direction map's sections,
  an opening promise, and section cards with a progress indicator.
- **Attention resets** at the interval the long-form profile measures: a
  layout change, an insert or a section card. They are planned, not random.
- **Recurring segment formats** (for example a "tool of the week" card) are
  defined in the style, so a series looks like a series.
- **Rendering by chapter**, using the existing scene-level re-render, and
  **cut-downs** to Shorts from the same storyboard (the roadmap's launch
  kits). A Short re-plans its section against the Shorts profile instead of
  cropping the long form.

### 10.3 Bring-your-own raw footage

The base edit has to be excellent before anything is dressed. The Ship Mode
run found three gaps:

1. **Restarts inside a sentence** ("but however, but whatever") cannot be
   cut: semantic retakes work on whole passages. Add word-level restart
   decisions with the same receipt rules (inclusive word ranges, last take
   wins, evidence-bound).
2. **Word timing decides cut quality.** One recogniser timed first words too
   early and left a rejected word's tail in the edit; another dropped words.
   Run two local recognisers and take each word's timing where they agree,
   with the RMS envelope as the tiebreak. Record disagreements as QA issues,
   as today.
3. **Rejected-speech tails** before a kept word need detection and a guarded
   contraction, proven from the envelope and an independent alignment. Today
   the only option is a review that can resolve or block, but not fix.

Then dressing:

- whole-video face tracking (section 7.2);
- layouts built on the cut-out (section 7.1);
- B-roll capture suggestions from the direction map's `product` and `proof`
  lines (`broll-plan` exists);
- the direction map over the speaker's own words, never rewriting them.

### 10.4 Full motion graphics

This lane already has the most: the world camera, the concept tournament,
motion grammars and rendered candidates. It gains:

- the visual vocabulary (section 8);
- type systems in the style (scale, weights, how headlines break);
- a transition-rhythm measure in the motion profiles, so cut and transition
  cadence is checked, not just per-scene timing.

## 11. The quality loop

### 11.1 Prototype first

For any story over 60 s, both paths render the first 20–30 s first, using
the full style, layouts and sound, and stop for review. On the skill path the
user sees it. Headless, the critic reviews it and `make` continues only on
`ship`. This is the skill's "prove one integrated sequence" step, made
mandatory and shared.

### 11.2 Gates against profiles

The existing gates stay. The motion gate's fixed floors become profile bands,
which fixes the false failure on locked-off talking heads. New gates:

- **Coverage:** coverage, face time and the longest undressed run against the
  profile band.
- **Direction:** every line covered by the direction map, and the scenes it
  names exist.
- **Style:** the `style check` measures (section 9.5).
- **Face:** the face rule over the whole-video track (section 7.2).

### 11.3 Critic rubric

`qa/critic.json` findings gain three categories:

- `missed-opportunity`: a line whose intent calls for a visual and has none;
- `sparseness`: a run longer than the profile allows;
- `brand-consistency`: a scene that breaks the style or the brand frame.

The critic also gets a **reference comparison sheet**: render frames beside
anonymised frames from the profile's own reference set (our own references
only), to judge register and density side by side.

### 11.4 Retention feedback (later, opt-in)

When a user connects YouTube analytics, per-video retention curves are joined
to the direction map's sections and treatments. That shows which treatments
hold attention for that channel. It adjusts that user's style profile only,
never the shipped defaults, and never sends their data anywhere else.

## 12. Entry points

| Command | Change |
|---|---|
| `launchclip make` | Picks a profile; plans the direction map, then the storyboard; tracks the face; renders and reviews a prototype for stories over 60 s; new gates in `finish` |
| `launchclip story plan` | Writes `DIRECTION.json` with `storyboard.json` |
| `launchclip story validate` | Requires and checks the direction map in footage-led and motion lanes |
| `launchclip subject track <video>` | New. Whole-video head and body track |
| `launchclip finish` | Coverage, direction and style gates; `--prototype` renders the opening only |
| `launchclip style create --from-reference` | Also measures a cadence profile, layout mix and caption treatment |
| `launchclip style check` | Becomes a gate when the story names a style |
| `launchclip profile list / show / measure` | New. Inspect shipped profiles; measure a folder of references into one |

**Skills:**

- The create-video skills get generated references, `direction-map.md` and
  `profiles.md`, from the same registry, under the same `skills:check` drift
  rule.
- The recorded-video and new-story workflows write the direction map before
  the storyboard, and run the prototype step.
- A parity test, extending `test/subject_paths.test.js`, plans one fixture
  per format through both paths and checks the same direction map intents,
  the same profile, and matching coverage.

## 13. Phases and PRs

Small commits, stacked PRs, each green on its own.

| Phase | Lands | Done when |
|---|---|---|
| 0 | This RFC | Reviewed and merged |
| 1 | Profile schema; new measures (coverage, face time, longest undressed run, layout changes); `profile measure`; reference sets and the six shipped profiles | Each shipped profile is measured from its references, with provenance; a LaunchClip render's coverage matches its storyboard exactly |
| 2 | Direction map: contract, intents, validation, coverage from map and storyboard; planner writes it first; skills write it first; motion and density rules become profile bands | The Ship Mode footage, re-planned headless and on the skill path, has every line covered and lands inside the profile's coverage band |
| 3 | Whole-video face track; `subjectContext` reads it; face rule over the track | layout-check fails an overlay on the head outside any matted range |
| 4 | Footage layouts (`full`, `split-*`, `framed`, `stacked`, `insert`), the `layout-shift` transition, both renderers with parity | A footage fixture switches split and full per section in both renderers within parity |
| 5 | Visual vocabulary: the icon set, `concept-card`, `icon-row`, `stat-card`, `quote-card`, `compare`, `timeline`, `excerpt`, `object-card`, `section-card` | Each module has parity fixtures and intent rules; the planner picks them for their intents in the parity test |
| 6 | Style v3: layout rules, vocabulary, profile, brand frame, caption defaults per lane; dials; `style check` gate; reference-drafted styles produce profiles | Two stories in one style pass `style check` against each other; dials stay inside the band (pinned by a test) |
| 7 | Quality loop: prototype step, coverage, direction and style gates, critic rubric categories, reference comparison sheet | A sparse draft (fixture) fails coverage and gets `missed-opportunity` findings; a dressed one passes |
| 8 | Base-edit quality: in-sentence restart decisions, consensus word timing, guarded tail contraction | The Ship Mode raw recording edits clean, with no residue or kept restarts, with no manual retranscription |
| 9 | Long form: chapters and section cards, attention resets, recurring segments, cut-downs re-planned against the Shorts profile | A 10-minute fixture renders by chapter, and a Short cut from it passes the Shorts profile |
| 10 | Retention feedback (opt-in) | A connected channel's style profile updates from its retention, and shipped defaults are unchanged |

Phases 3 and 5 can run beside phase 2. Phase 8 is independent and can start
any time.

## 14. Open questions

1. **Reference sets.** Which videos, how many per profile, and how often are
   they re-measured? Public videos for statistics only, or only our own and
   licensed ones?
2. **Coverage for references.** Estimating "designed graphic on screen" from
   pixels is approximate. Is a hand-labelled subset needed to calibrate it?
3. **Layouts without a matte.** Is split on the base camera alone good enough
   when there's no cut-out, or does split need the room dimmed (matte
   required)?
4. **Dial semantics.** Are four dials right? Should `density` be per section?
5. **Prototype gate headless.** Is a model critic on the prototype enough to
   continue unattended, or should `make` stop and ask when it runs attended?
6. **Illustration ceiling.** Composed objects from icons and shapes go a long
   way. Where do we draw the line before generated imagery, which brings cost,
   consistency and honesty questions?
7. **Style v3 migration.** Upgrade in place, or keep v2 and add v3 alongside?
