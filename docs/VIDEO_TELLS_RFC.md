# RFC: Tells, taste and the copy check

Status: draft, open for review
Date: 2026-11-16
Roadmap entry: "Taste checks: tells, copy and art direction" ([ROADMAP.md](ROADMAP.md))

> Code and prompt text from other projects are copied only where their licence allows it, with the notice kept. Everything else here is written fresh in our own words. Every source, its licence and what we take from it is listed under Provenance.

A video can pass every finish gate and still read as generated. The gates
measure whether it works: captions legible, nothing ghosted, motion easing the
right way. They do not ask whether the frame is a default. This section adds
that question in three places: the plan before the render, the rendered frame,
and the words. It also gives the planner an art direction to aim at, so the
checks rarely have anything to catch.

Three outside sources feed it, all licensed for reuse (see 7. Provenance):
a web-design detector with 62 rules and a set of copy regexes (`imp`), a
list of about 70 signs of generated UI, each with its fix (`uns`), and a
frontend design skill (`fd`). Their rules are for web pages. Below, each
one is translated into a video frame or dropped.

## 1. The tells registry

**File.** `kit/core/tells.mjs`: pure ESM, no imports outside `kit/core`,
like `motion-check.mjs`. One frozen array of entries, plus one detector
function per entry. Code, not JSON, because most detectors are a few lines
that read the resolved story.

```js
{ id: 'dissolve-everywhere',
  category: 'slop',            // slop: a default nobody chose. quality: a craft failure.
  severity: 'warning',         // error fails the gate; warning lists; advisory only in the critic packet
  applies: 'plan',             // plan (story, ops, params; no render) | frame (rendered pixels or layout rects) | script (narration and on-screen text)
  detector: 'dissolveShare',   // the function in tells.mjs
  fix: 'Pick each transition by meaning: cut for contrast, push for continuation, whip for speed.',
  added: '2026-11-16',         // the date the tell entered the registry
  retired: null,               // a date once the tell stops reading as generated
  source: 'roadmap' }
```

The dates matter. A tell is a fashion: the last wave of generated work all
used one font, the next wave uses another. `added` lets a later review retire
rules that no longer fire on real drafts, and the gate report prints the date
with each finding.

**Where it runs.**

| Applies to | Runs in | Needs a render |
| --- | --- | --- |
| plan | new `tellsGate(story)` in `src/direction_guardrails.js`, beside `varietyGate`; also under `--plan-only` | no |
| frame | `runGates` in `src/finish.js`, filed as `tells` in `qa/finish/gates.json`, using the layout check's rects and sampled frames | yes |
| script | `checkScript` in `src/script_check.js` (see 2.) | no |

Findings use the gate shape every guardrail already uses: `{rule, severity,
at?, ids, detail}`, with `detail` ending in the fix.

**The rules.** P = plan, F = frame, S = script. Severity is `W` warning,
`A` advisory, `E` error. Every threshold here is a proposal to calibrate on
the example stories (phase 2): the bar is zero errors on every shipped
example.

*From the roadmap (the named video tells)*

| id | The tell in a video | At | Detect | Fix |
| --- | --- | --- | --- | --- |
| quote-card-wide-set | A quote or fact card floats over a wide world shot with no one reacting to it | P | `quote-card`/`excerpt` on a higher track over a `world` scene with no cast within the card's third | A character reacts or points up at it (guardrails §5), or a tighter set |
| dissolve-everywhere | Every cut is a fade | P | over half of `scene.in` types are `fade` or crossfade, in a video of five or more scenes | Transitions chosen by meaning (design.md already says so; now it is checked) |
| centred-title-hook | The hook is a centred text card | P | first scene starts before 0.5 s, is text-only and centred, and holds over 1.5 s | Open on the subject: the object, the place, the number on its thing |
| fact-card-vs-caption | A card says the same words as the caption at the same time | P | on-screen text shares 60%+ of its words with the caption line under it (`imp` repeated-container-text, turned to time) | Card carries the figure or name; the caption carries the sentence |
| identical-entrance | One entrance on every scene | P | the same entrance tween on 80%+ of scenes, or three or more entry directions inside one scene (`imp` craft floor, `uns` motion, `fd`) | One authored entrance for the focal element; supporting parts quieter |

*Surfaces and colour*

| id | The tell in a video | At | Detect | Fix |
| --- | --- | --- | --- | --- |
| ai-palette | Purple-to-blue gradients; cyan on near-black (`imp` ai-color-palette, `uns`) | P | brand colours: a gradient between hues 250–300°, or a cyan accent (180–200°) on a background under 8% lightness | Palette from the world line of the direction (see 3.) |
| cream-default | Warm cream ground, serif display, clay accent (`imp` cream-palette, `fd` trait 1) | P | background near #F4F1EA with a serif display role and an accent near #D97757 | Same |
| gradient-text | Gradient fill on a headline or number | P | a label's fill is a gradient | Solid colour; emphasis by size or weight |
| glow | Coloured halo on cards, rims or text (`imp` dark-glow, `uns`) | P | `rim-glass`, `callout.treatment.glow`, zero-offset coloured shadow | Allowed only where the glow is the information (a pulse running down a wire). Otherwise surface steps |
| radial-wash | A coloured radial blob behind content (`imp` radial-halo, radial-spotlight-glow) | P | a plate or ambient light that is a saturated radial gradient behind a card | A plate from the world, or a neutral one |
| glass-default | Glass panels where the world has no glass (`uns`, `imp` craft floor) | P | `presentation: "glass"` or `rim-glass` without the direction asking | Solid panel |
| grid-stripes | Hairline grid or stripes as decoration (`imp` codex-grid-background, repeating-stripes) | P | a grid or stripe plate when the world is not a map, blueprint or instrument | Plain plate |
| accent-everywhere | Accent on many things, so nothing leads (`uns`) | F | accent-coloured pixels over 10% of the frame outside a `moment` scene (derived) | One accent, once or twice a frame |
| chart-shades | Chart series in tints of primary and accent, so no series leads (`uns`) | P | a multi-series chart using `seriesColors` defaults with no `highlight` | Neutral steps for the rest, the accent on the one value the line names |
| gray-on-color | Muted grey text on a coloured panel (`imp`) | P | `theme.muted` text on a panel whose surface saturation is over 30% | A darker shade of the panel's hue |
| ghost-card | Hairline border under a wide soft shadow (`imp` gpt-thin-border-wide-shadow) | P | panel has both | One: border or shadow |
| hard-offset-shadow | Unblurred offset shadow (`imp`) | P · A | shadow blur 0, offset 4 px or more | Only in a world that chose it |

*Type*

| id | The tell in a video | At | Detect | Fix |
| --- | --- | --- | --- | --- |
| overused-font | A default face nobody chose (`imp`) | P · A | a role resolves to a listed face *and* `brand.fonts` did not name it | See 5. |
| kicker | A tiny tracked uppercase label above a headline: "Chapter 2" (`imp` kicker, hero-eyebrow; `uns`; `fd`) | P | a label of 3 words or fewer, upper case, tracking 0.08em or more, directly above a headline. `beat-director.mjs` sets `kicker: "Chapter N"` today | Delete it; the headline carries itself |
| numbered-labels | 01 / 02 / 03 on things that are not a sequence (`imp`, `fd`) | P | number prefixes on headlines when the direction map's intent is not `list` or `process` | Numbers only for real steps (`step-rail` numbered stays fine) |
| tracked-caps | Uppercase labels with wide tracking (`uns`, `fd`) | P · W | label upper case, tracking 0.1em or more, not a caption chip (`ticker-tape` tag sets 0.14em) | Sentence case, normal tracking |
| accent-word | One word in a headline italic or in the accent colour (`fd`) | P · A | headline with one span styled apart | Allowed in captions, where it is a convention of the format; in headlines, emphasis by size |
| italic-serif-hook | Oversized italic serif as the hook headline (`imp`) | P · A | first headline in an italic serif display face | A face chosen for the character |
| flat-hierarchy | Headline and body less than 1.25× apart (`imp`); too many sizes (`uns`) | P | in one scene, adjacent text roles under 1.25×, or over four sizes | Fewer, further-apart sizes |
| crushed-tracking | Letter spacing under −0.04em (`imp`, `uns`) | P | label spacing | −0.02 to −0.03em on display at most |
| mono-costume | Monospace on labels that are not code or data (`imp` craft floor, `fd`) | P · A | `meta` role on a non-numeric line (`odometer`'s `sub` sets source lines in mono with 0.06em) | Body face; mono for figures and code |
| oversized-headline | A full sentence at display size (`imp` oversized-h1) | P | a headline of more than 6 words at display size | Fewer words, or a smaller step |
| straggler | One word alone on a headline's last line (`imp` straggler, unbalanced-heading) | P | `fitText` result, three or more lines, last line one word | Balance the break in `fitText` |
| caps-body | All caps on a long line (`imp` all-caps-body, wide-tracking) | P | upper case on text over 12 words | Sentence case |
| mixed-number-format | `$48,210` beside `$124,860.40` (`uns`) | P | numbers in one video with mixed decimals or formats | One `numberFormat` per video |

*Structure, objects and pictures*

| id | The tell in a video | At | Detect | Fix |
| --- | --- | --- | --- | --- |
| hero-metric | Big centred number, small label, a mono source line, an accent, and nothing else in frame (`imp` craft floor, `fd`) | P | a `stat-card`/`odometer`/`metric` scene with no cast, object or chart in it, more than once a video or as the hook | Put the number on the thing it counts, in the world (`uns` "stat cards are numbers" plus a real object) |
| card-grid | Three or more same-size cards, each icon plus title plus line (`imp` craft floor, `uns`) | P | sibling panels of equal size and identical structure | Varied sizes, one leads; or `item-list` |
| icon-tile | A rounded icon tile above a heading (`imp`) | P | icon in a filled tile directly above a headline | Icon beside the text, or none |
| emoji-icons | Emoji as icons or decoration (`uns`, `imp` craft floor) | P | emoji in any on-screen param (`audience-grid` tiles accept them) | One icon set (`catalog-h-icons`) or none |
| decorative-chrome | Sparklines, progress rings or tallies with no data behind them (`imp`, `uns`) | P | `sparkline`/`progress-ring` without `source` or brief-traced values | Remove, or show the real series |
| pulsing-dot | A small element looping a pulse when nothing is live (`imp`, `uns`) | P | a `loop` op on opacity or scale of an element under 2% of the frame, not tied to an event | Static |
| blinking-cursor | A typing caret where nothing is typed (`imp`) | P · A | caret element outside a recorded terminal or editor | No caret |
| marquee | Text scrolling past continuously (`imp`) | P · A | `ticker-tape` used for anything but a feed the line names | A list that builds |
| bounce | Bounce, elastic or overshoot on simple elements (`imp`, `uns`) | P | `back.out`/`elastic` eases outside the `playful` grammar or a named emphasis (34 uses across catalogue H today; the `kinetic` feel springs with 27% overshoot) | Expo or quart out. Note the house camera rule already says no overshoot |
| clipart | A hero-sized picture built from primitive shapes (`imp` shape-assembled-illustration; `uns` glossy blobs) | P · A | a planner-drawn `graphic` over 30% of the frame | A real asset, a photo, or a drawn world |
| ai-stock-imagery | Robots, glowing brains, circuit lines for anything about AI (`uns`) | P | asset prompts or search terms with those words when the subject is software | Show what the software produces |
| baked-text | Words, fake buttons or logos inside a generated image (`uns`) | P · A | a generated asset whose prompt contains quoted text | Real text over a clean image |
| buried-raster | A photo under a near-opaque wash or blur, so it never shows (`imp`) | F | `media_presence` finds no detail in an `image` plate with `dim` over 0.85 | Less dim; or no photo |
| unblended-media | A media rect with a hard edge and a different black (`uns`) | F · A | edge contrast between the media rect and the plate | Match the ground, soften the edge |
| thin-text-on-footage | Small or thin type set straight over a busy shot, often on a wash of the brand colour (pilot review) | F | a text element over media whose size is under 56 px (at 1080) or weight under 600, with 14% or more edge pixels around it | Larger, heavier type on a local dark grade, or off the busy part of the shot |
| organic-mask | A polygon or circle mask faking a subject's outline (`imp` organic-clip-path, craft floor) | P | a clip path with more than 12 points on a photo | A real matte from subject matting |

*Already covered* (no new rule; the gate that owns it is named): broken
image (validate: missing asset), script error (render failure),
content-hidden-at-rest (ghosting gate), text-occlusion and edge-flush cards
(layout check collisions and safe zone), low-contrast (caption legibility;
extend to all text in phase 2), tiny and undersized text (44 px key text,
`minTextPx`), text-overflow (`fitText` refuses), social proof and
placeholder data (script check `social-proof`, `placeholder`, `fact-trace`),
the four `design-system-*` rules (style adherence; a custom module's colour
outside the brand is the only gap).

*Does not transfer:* first-viewport column overflow, skipped heading levels,
heading rhythm, justified text, clipped overflow containers, browser surfaces
(scrollbars, carets, focus rings), parallax on scroll, `transition-all`,
animating width or height (ops cannot), right-to-left layout signs (a
separate concern), heavy 800–900 headings (display faces are poster type in
video), "a visual on every section" (a video needs one on every line), the
4 px spacing scale and nav row heights, trailing periods on buttons, and
cramped padding (`fitText` and panel insets own it).

### Phase 2: what landed, and the calibration

`kit/core/tells.mjs` holds every row above as a registry entry dated
2026-11-16. `tellsGate(story, {words})` in `src/direction_guardrails.js` runs
the plan rules on the resolved story, each scene's model, and the view tree
and op list both renderers draw and play. finish files it as `gates.tells`
(so `--plan-only` runs it), and `checkStoryboard` sends its errors to the
storyboard repair pass and lists its warnings.

Calibrated on the 40 stories under `examples/story/`: none has a tells
error. Changes from the proposals above:

| Rule | Change | Why |
| --- | --- | --- |
| gradient-text, emoji-icons, bounce | error | No example hits them |
| kicker | warning (the refuse list says always) | Fires 17 times: module labels (`gauge-compare` "SAVED", `object-card`, `footage-callout`, `archive-card`) and planner `kicker`/`eyebrow` params on `hook-title`, `brand-lockup`, `section-card` |
| ai-palette | warning | 19 examples still carry the old cyan-on-near-black brand |
| glow, ghost-card | warning | Shipped modules (`node-graph`, `flow-compare`, `process-steps`, the 3D bars and rack, chart highlights) draw coloured halos and bordered shadowed panels |
| every other plan rule | warning or advisory as marked | |
| dissolve-everywhere | counted over the cuts, from the second scene | The first scene has no cut in |
| identical-entrance | needs four or more scenes | Most examples share the grammar's one entrance, so this warns widely |
| flat-hierarchy | sizes within 10% count as one before "over four sizes" | Perspective labels in the 3D charts |
| centred-title-hook | text-only means no pictured scene overlaps it | |
| bounce | `back.out`, `back.inOut`, `elastic`, `bounce` only | `back.in` is an anticipation on an exit, not an overshoot |
| overused-font | only roles the planned text is set in | The `serif` role defaults to Instrument Serif, but most videos never use it |
| mono-costume | `excerpt` exempt, with code and terminal modules | It quotes code verbatim |
| quote-card-wide-set | at plan time: overlaps a `world` scene with no cast scene | The density gate's `lone-card` still measures the rects after layout |

**The hero-metric template is fixed in the module.** The default `stat-card`
sets flush left, so the figure leads a column instead of floating centred
over a small label. Its source line uses the body face in every variant. The
sub line under `odometer` and the other counters drops mono and its 0.06em
tracking. One core view, so both renderers change; parity fixture
`g-stat-card-flush-left`. The `hero-metric` rule still warns when a bare
number is the hook or appears more than once.

**Still to do:**

- The on-screen copy rules of §2 (`exclaim`, `meta-dots`, `em-dash` labels,
  buzzwords) in `tellsGate`, through the functions in `src/script_check.js`.
- View trees for catalogue A, D and the character modules (`hook-title`,
  `metric`, `cta`, …). The gate reads their params and ops but not their
  type, so the type rules miss them.
- `straggler` wraps with the text-fit advance model, not `fitText`'s own
  breaks; move it onto `fitText` once that returns its lines.
- Contrast on all text (the phase 2 row below) is not in this phase.

### Phase 3: what landed

**The direction block, `hero` and `motion.thesis`** are story fields, checked
by `validateStory` (`kit/core/story.mjs`): `direction {product, character,
world, moments, signature: {detail, element}}`, `scene.hero` (the element
id, a string, rather than `hero: true` on an element: most modules have no
per-element plan fields to mark), and `motion.thesis {focal, continuity,
emphasis, budget}`. Every field is optional, so old stories still validate.
`direction.character` refuses the template words by name (an error) and
`direction.moments` must be one or two scene ids. Nothing renders from them,
so both renderers are untouched. The planner prompt and the storyboard
reference gain an "Art direction" section ahead of the contract, the example
storyboard carries all three, and `skills-src/shared/design.md` teaches them.

Two plan rules read them, and only when the story has a `direction` block
(none of the shipped examples do yet, so calibration is unchanged):

| id | Detect | Severity |
| --- | --- | --- |
| hero-missing | a main-track scene with no `scene.hero` | warning |
| signature-thin | the signature's element id on fewer than three scenes (in the params, the hero or a view node id) | warning |

**The frame rules** have detectors. `frameTells` in `kit/core/tells.mjs`
judges pixels that `src/frame_tells.js` samples, and finish adds the findings
to `gates.tells` after the render (warnings and advisories only, so they never
fail the gate). Both renderers draw the same frame, so one measure covers
both.

| Rule | Sample | Detect |
| --- | --- | --- |
| accent-everywhere | one quarter-size frame per main-track scene, mid-hold | over 10% of the frame within RGB distance 48 of `brand.colors.accent` (or `primary`), outside `direction.moments`. Off when the accent is within 48 of `bg`, `background` or `paper` |
| buried-raster | each image or video plate with `dim` over 0.85, read from its asset (the media-presence grey frames) | the asset has detail (edge share at least 1%) and loses it once the edge step is scaled by 1 / (1 − dim) |
| unblended-media | each media window the layout check placed (not full frame, not the footage base), full size, mid-time | a mean colour step of 60 or more across the edge on three of its measured sides, and black levels (the darkest tenth of the luma) 12 or more apart inside and around it |
| thin-text-on-footage | each text element over media (a window, a full-frame shot or the footage base), full size, mid-time | a size under 56 px (scaled to the canvas) or a declared weight under 600, and at least 14% of a ring around the text on an edge (a luma step of 24) |

Changes from the proposals: buried-raster reads the asset and the planned
dim rather than the rendered frame, because cards drawn over the plate add
edges of their own. It does not model the plate's blur yet, so a blurred and
dimmed photo can slip by. The frame thresholds are set on synthetic frames
(`test/tells.test.js`, `test/frame_tells.test.js`), not yet calibrated on
renders of the example stories.

**Left for later:** calibrating the frame thresholds on rendered examples;
the plate blur in buried-raster. (The critic reading `motion.thesis` and the
template check landed in phase 4.)

### Phase 4: what landed

All in `runHeadlessCritic` (`src/make/critic.js`) and the repair loop
(`src/make/critic_repair.js`, `criticRepairs` in `src/make/index.js`), as §4
describes:

- **The split.** Pass A (`launchclip_make_critic`) sees the sheets, the
  shot list, the rules and the storyboard's `direction` and `motion.thesis`,
  never the tooling. Its schema puts `template {swappable, why}` first, so the
  model answers the template question before it lists findings; a swappable
  video is a `specificity` finding. Pass B (`launchclip_make_critic_check`)
  runs only when finish's coverage gate or tells gate found something: it gets
  A's findings and each tooling finding and marks it `agree` or
  `false-positive`. The answers land in `qa/critic.json` under
  `tooling_checks` (`unchecked` when pass B failed or skipped one). The
  coverage findings still count toward the verdict as before; a false positive
  is a note for threshold tuning, not a waiver.
- **`recapture`.** A verdict of the final review (not the animatic's). The
  model may give it, and tooling sets it when the sheets are partial (a sheet
  missing on disk, a sample with no evidence) and the model said ship. In
  `make`, a recapture round deletes `qa/temporal-evidence` and
  `qa/critic-sheets`, reruns finish (the render is cached, so only evidence and
  gates run) and asks pass A again. The planner is not called.
- **The verdict pass.** A repair or replan round calls the critic with
  `prior` (the critique it answers). Its blocking and major findings are scored
  `resolved | partial | unresolved` (`launchclip_make_critic_verdict`), with at
  most three regressions and no new hunt. A finding the model did not score
  counts as unresolved. Anything short of resolved stays a finding at its
  severity, so it forbids ship. Only the new sheets are sent, never the
  planner's account of its fix. The scores land in `verdict_pass`.
- **`keep`.** Up to five lines, from pass A or the verdict pass (else carried
  from the prior). They reach the planner as `keep (it works; do not lose
  it): …` lines in a repair's seed errors, a "Keep these, they work" list in a
  replan brief, and every chunk a long-form round directs.

**Left for later:** the character-story retake rounds (`src/make/retakes.js`)
still ask the critic afresh each round; a recapture there has no shot to aim
at and stops the rounds. Nothing yet collects `tooling_checks` across runs for
threshold tuning.

### Phase 6: what landed

`make --comps` adds a `comps` stage after the storyboard (`src/make/comps.js`,
`stageComps` in `src/make/index.js`). It runs only with the flag, so other
runs keep their stage list.

- **Three comps of the hook.** Comp 1 is the planner's opening scene. Comps 2
  and 3 come from the opening designer (`designOpening` in
  `src/make/candidates.js`), each with a note that fixes its shape (2 is
  sparse, one element alone; 3 is dense, several elements in one layout),
  lists the comps already made and tells it to lead with another element in
  another layout. Palette and type stay as the direction set them. A design
  that repeats a comp, or fails the storyboard checks, is dropped with a note.
  At least two comps are needed. Each comp is `comps/<id>/storyboard.json`
  (the plan-only storyboard) and `comps/<id>/still.png`, one still at the
  hook's peak from the project's renderer.
- **One pick.** `--comp N` is the person's pick. An attended run (a terminal,
  or the app's `ask`) stops `awaiting-approval` (exit 3) with the stills
  listed, and the same command with `--comp N` picks from the same comps
  without designing them again. A headless run lets the vision judge
  (`judgeCandidates`) pick from the stills, recorded as `by: "critic",
  delegated: true`. With no model that can see, comp 1 stands (`by:
  "default"`) and the run warns. The picked comp's storyboard becomes
  `storyboard.json`.
- **The record.** `MAKE.json` `comps`: the hook scene and time, each comp's
  module, still and storyboard, and `picked {id, still, storyboard, by,
  delegated, rationale?}`. The candidates stage then leaves the hook alone and
  compares only the risky transition.

**Left for later:** footage-led, long-form and visual-explainer videos skip
comps, for the same reasons the candidates stage skips them. The comps change
only the hook scene, not the whole layout of the video.

## 2. The copy check

The words are the cheapest place to catch a tell, and `checkScript` already
has the shape: pure, deterministic, one report with ids and fixes, called by
`make` after the script pass (`src/make/index.js`, the `first` check) with
one repair pass on errors. It already warns on `superlative`. Add these, to
the narration and to every on-screen string the storyboard sets (headline,
label, card body):

| id | Rule | Severity |
| --- | --- | --- |
| `buzzword` | The phrase list below, case-insensitive substring | 1: warning; 2 or more, or any in the hook: error |
| `aphorism` | `Not a X. A Y.` and `X. No Y.` / `X. Just Y.` constructions, plus the house tics | 2 in a script: warning; 3: error |
| `em-dash` | Narration: 3 or more and at least one per 500 characters (the source's floor of 8 is for web pages; a 60 s script is about 800 characters). On-screen text: any `WORD — fragment` label | warning |
| `theater` | "X theater" for a closed list of heads (security, growth, productivity, alignment, compliance…) | warning |
| `exclaim` | `!` in on-screen text; `!!` anywhere (`uns`) | warning |
| `bare-change` | `+12%` or "3 fewer" with no "vs" or "than" within the sentence (`uns`) | warning |
| `meta-dots` | On-screen `A · B · C` strings and a trailing `→` (`fd` trait 5) | advisory |

**Buzzwords.** Merge the existing `SUPERLATIVE` regex with the detector's
phrase list (Apache-2.0, ported with notice): streamline your, empower your,
supercharge your, unleash your / the power, leverage the power, harness the
power, built for the modern, trusted by leading / the world, best-in-class,
industry-leading, world-class, enterprise-grade, next-generation,
cutting-edge, transform your business, revolutionize, game-changer / game
changing, mission-critical, best of breed, future-proof, seamless experience,
seamlessly integrate, drive engagement / growth / results. Add from the signs
list: unlock, magic, magical. The fix line: "say what the thing does, with
its own nouns".

**Aphorism regexes** (ported to JS from the detector):

```js
const NOT_A = /\bNot an? [a-z][^.!?]{1,40}[.!]\s+[A-Z][^.!?]{1,60}[.!]/g;
const REBUTTAL = /\b[A-Z][^.!?]{4,80}[.!]\s+(?:No|Just)\s+[a-z][^.!?]{2,60}[.!]/g;
// House tics, LaunchClip's own: the prompts taught these.
const NOBODY = /\b(?:nobody|no one) (?:checks|talks about|tells you|notices|sees)\b/gi;
const ITS_NOT = /\b(?:it'?s|this is) not (?:just |about )?[^.,;!?]{1,30}[,;:—–-]+\s*(?:it'?s|this is)\b/gi;
const HERES = /\bhere'?s the (?:thing|catch|kicker|part)\b/gi;
```

One use of any of these is voice. The pattern is the tell, so counts are per
script. A skeleton whose hook template is the phrase
(`skeleton-library.mjs` `nobody-tells`) gets one free use in its hook.

**Where it runs in `make`.** The copy rules join `checkScript`, so they run
at the three call sites `make` already has (write, after the resize pass, and
on `--refine`), and errors feed the existing single repair pass. On-screen
text is checked by the plan `tellsGate` with the same functions, imported
from `src/script_check.js`, after the storyboard pass. No new stage.

**The fix in `kit/core/script-formats.mjs`.** The prompt teaches the tic it
should ban. Line 66 (`stakes-list` open loop), line 68 (its pattern
interrupt) and line 460 (`SHORT_VIDEO_RULES`, the open-loop rule) all use
"the one nobody checks" as the model example, so drafts come back with it.
Change the examples to concrete ones:

- line 66: `"…and one fix I'll give you at the end", "number three costs the most to fix"`
- line 68: `"The word is per.", "All three fail the same way: water sits on the cut end."`
- line 460: `"the last one is the cheapest fix", "one fix I'll give you at the end"`

and add one rule line to `scriptRuleLines`: *"No stock cadence: no 'nobody
checks', no 'Not X. Y.', no 'X. No Y.', no 'here's the thing'. Name the
specific thing instead."* The `STAKES` fixture in
`test/script_check.test.js` (line 275) uses the phrase once and stays valid:
one use is under the threshold. Regenerate the synced copies under `skills/`.

## 3. Art direction for the planner

Today the art direction is free text that picks a motion grammar
(`suggestMotion`) and favoured moods. Give it a shape. Add to
`skills-src/shared/design.md` and the planner prompt a `direction` block in
`storyboard.json`, written before any scene:

- **Product.** What the subject is and who the video is for, one sentence.
- **Character.** Two or three concrete words ("exact, a little warm").
  Refused, because they describe every template: clean, modern, sleek,
  minimal, premium, and for video also dynamic, engaging, vibrant, stunning,
  professional, bold. `validateStory` rejects them by name.
- **World.** The place or material the subject belongs to. It sets the
  plate, the neutral tint and the accent. A note app lives near paper and ink.
- **Moments.** One or two scene ids where colour and detail are allowed to be
  rich. Everywhere else is quiet.
- **Signature.** One small detail only this video would have, on at least
  three scenes, named by element id so the plan check can count it.

Then the rules the planner works to, each with a check:

| Rule | Check |
| --- | --- |
| **Template check.** If you swapped the subject for another, would the video still fit? If yes, push the copy, the world and the signature harder | Planner self-check; critic category `specificity` (4.) |
| **One bright element, quiet chrome.** Each scene marks one element `hero: true`. It carries the colour and the biggest move; captions, labels and panels stay in the neutrals | `hero` present per scene. This is also what the roadmap's "hero as the biggest move" motion rule needs: the plan now says which element is the hero |
| **Accent share.** One accent, used once or twice a frame | `accent-everywhere` (F) |
| **Refuse list.** Eyebrows and kickers (always); gradient text; glass and glow as decoration; side-stripe cards; identical card grids; the hero-metric template; sparklines standing in for content; emoji as icons; mono as costume. Each may be earned by the brief's own words, except the kicker | The plan tells above |
| **Motion thesis.** Before scenes: the focal moment (one per video, from this subject), continuity (what carries between scenes), emphasis (which words get a beat), budget (what is expensive and how often) | `motion.thesis` field; the critic reads it |
| **Not one identical entrance on every scene** | `identical-entrance` |
| **Three structural comps, then one approval.** Before the full render, three stills of the hook scene that differ in what leads, the topology and the density (not in palette or type, which the direction fixes). The user picks one; the pick is recorded in `MAKE.json` with the comp path. Headless `make` lets the critic pick and records it as delegated | `make --comps`: three `--plan-only` storyboards, one still each |

The comps reuse what exists: the concept tournament already pits five
concepts in a fresh context; this pits three layouts of the winner. It also
matches the house rule of a direction map and prototype before a full render.

## 4. Reviewer loop

The critic in `src/make/critic.js` is already a fresh-context reviewer with a
verdict and evidence ids. Four changes, borrowed from the motion and finish
reviewers:

1. **Judge before reading the detectors.** Today finish's `quality` findings
   go to the model as known facts, so they anchor it. Split the call: pass A
   judges the sheets with no gate or tells findings and must answer the
   template question first; pass B gets A's findings plus the tooling
   findings and marks each tooling finding `agree` or `false-positive`. Both
   land in `qa/critic.json`; false positives feed threshold tuning.
2. **Add `recapture`.** Verdicts become `ship | repair | replan |
   recapture`. Recapture means the evidence is bad (blank or half-loaded
   tiles, left and right tiles that differ from a capture fault, missing
   samples): rebuild the sheets, never repair the video. A partial set of
   sheets can never earn ship.
3. **A verdict pass after a repair.** `critic_repair.js` asks the critic
   again from scratch each round. Instead, the second round scores each prior
   blocking or major finding `resolved | partial | unresolved` against the
   new evidence ids, names at most three regressions, and starts no new hunt.
   Partial or unresolved forbids ship. The planner's account of its fix is
   never sent: only the new sheets count.
4. **`keep`.** Each review names what must survive the fixes. It goes into
   the repair prompt so a repair does not flatten the one good moment.

The verdict stays derived, never felt: ship only with no blocking or major
finding. New critic category: `specificity`.

## 5. The font question

`FONT_ROLE_DEFAULTS.body` is Inter, `DEFAULT_BRAND` sets Space Grotesk, the
`serif` role is Instrument Serif. All three are on the detector's overused
list, with Fraunces and Plus Jakarta Sans. In `style-seed.mjs`, 23 of 37
pairings use a listed body face (13 Inter, 8 Space Grotesk, 2 Plus Jakarta).

Recommendation:

- **Keep Inter in the registry and in every stack.** The text-fit tables are
  calibrated on it and it is a safe fallback. It is never wrong to render.
- **Change the default body to an unlisted family with tabular figures**,
  tried in this order: DM Sans, Manrope. Pick by rerunning the text-fit
  fixtures (DM Sans sets narrower, 0.64 vs 0.68) and a caption legibility
  pass at 9:16. Set `DEFAULT_BRAND` body the same way.
- **Rebalance the seed pairs** so listed body faces are a third or fewer.
  Inter stays where its tone fits (technical, serious).
- **`overused-font` is advisory and only fires on defaults.** A face the brand
  names is a choice and is never flagged.
- **Do not chase the list.** It moves with each wave. The registry's `added`
  date is the guard: re-check the overused list twice a year.

### Phase 5: what landed

- **Default body.** Manrope, set by the default-brand change (#636), since
  DM Sans's fontsource build has no tabular figures. Inter stays second in
  every body stack and stays the `fontWidthScale` calibration face.
  `DEFAULT_BRAND` lives in `kit/core/default-brand.mjs`, which the planning
  prompt re-exports, so this phase left `planning-prompt.mjs` alone. The
  planner copies `brand.fonts` unchanged, so there is no font guidance to add.
- **Seed rebalance.** Six `FONT_PAIRINGS` move their body face:
  `archivo-dm`, `unbounded-lexend`, `syne-manrope`, `bricolage-outfit`,
  `bricolage-manrope` and `instrument-dm`. Listed body faces fall from 17 of
  37 pairings to 11. Inter stays on the technical and serious pairings.
  `test/style_seed.test.js` keeps the share at a third or fewer, using
  `OVERUSED_FONTS` (now exported from `kit/core/tells.mjs`). A pack with no
  body face now reads as Manrope in `styleFingerprint` and `styleSummary`.
  Ids changed in place, so a reroll of an old seed that drew one of the six
  gets the new body. Saved packs render as saved.
- **Text fit.** `scripts/font-fit.mjs` compiles each of the 508 module
  parity fixtures with HyperFrames once per body face, measures every text
  run in Chromium at the mid hold, and reports the overflow a face adds over
  the baseline (Space Grotesk). Two kinds of run are skipped: runs wholly
  outside their box (carousels and tickers park items off stage) and repeated
  labels, which are paired in order. At Manrope, DM Sans, Outfit, Lexend and
  Inter, no module adds clipped glyphs. What it does flag is ellipsis
  truncation: names in commit, PR and social cards cut one character earlier
  or later, by design. It also flags a few runs that already overflow at the
  baseline and move by under 30 px. Parity with the new faces in the body
  role passes: process-steps and comparison-table with Manrope (min SSIM
  0.994), item-list with DM Sans (0.991), kinetic-words with Lexend (0.996).
- **Contact sheet.** `node scripts/element-sheet.mjs --body <face>` draws the
  element sheet with another body face, for before-and-after checks.

## 6. Phases, effort, tests

| Phase | Work | Files | Effort |
| --- | --- | --- | --- |
| 1 | Copy check; fix the three prompt examples | `src/script_check.js`, `kit/core/script-formats.mjs`, `skills-src/references/script-formats.md` | 1–2 days |
| 2 | Registry and the plan tells; `tellsGate`; contrast on all text | `kit/core/tells.mjs`, `src/direction_guardrails.js`, `src/finish.js` | 3–4 days |
| 3 | `direction` block, `hero`, `motion.thesis`; frame tells (accent share, buried raster, unblended media) | `kit/core/planning-prompt.mjs`, `skills-src/shared/design.md`, `validateStory` in `kit/core/story.mjs` | 3–5 days |
| 4 | Critic split, `recapture`, verdict pass, `keep` | `src/make/critic.js`, `src/make/critic_repair.js` | 2–3 days |
| 5 | Font defaults and seed rebalance | `kit/core/fonts.mjs`, `kit/core/style-seed.mjs`, `kit/core/planning-prompt.mjs` | 1 day plus text-fit runs |
| 6 | `make --comps` | `src/make/index.js`, `src/make/options.js` | 2 days |

Tests:

- Each detector: one story fixture that hits it and one near miss
  (`test/tells.test.js`). Copy rules: a hit, a single use under the
  threshold, and a false-positive guard ("Not a problem." alone; "the
  theater" as a building).
- Calibration: every example story and the `qa/make` fixtures pass with zero
  tells errors. A rule that cannot get there ships as a warning.
- Parity: the plan tells read ops both renderers play, so one test covers
  HyperFrames and Remotion.
- Critic: schema tests for the new verdict and the scored verdict pass; a
  repair round that leaves a finding `partial` cannot ship.

## 7. Provenance

| Item | Source path | Licence | Use | Attribution |
| --- | --- | --- | --- | --- |
| Rule ids and descriptions, 62 rules (as the basis for §1) | `imp` crates/live/assets/antipatterns.json | Apache-2.0 | rewrite (video terms) | Credit in `THIRD_PARTY_NOTICES.md` |
| Buzzword phrase list | `imp` crates/detect/src/regex_matchers.rs | Apache-2.0 | copy | Header comment in `src/script_check.js` + notice |
| Aphorism regexes, em-dash floor and density | `imp` regex_matchers.rs, foundation/src/rules/text.rs | Apache-2.0 | port (Rust to JS, thresholds changed) | Same, note the changes |
| "Theater" head list | `imp` crates/core/src/checks/html_patterns.rs | Apache-2.0 | copy | Same |
| Overused font list | `imp` crates/foundation/src/constants.rs | Apache-2.0 | copy | Notice |
| Refuse list, motion floor, "one identical entrance" | `imp` skill/reference/craft-floor.md | Apache-2.0 | rewrite | Notice |
| Motion thesis (focal, continuity, feedback, budget) | `imp` skill/reference/animate.md | Apache-2.0 | port | Notice |
| Disposition, recapture, verdict pass, keep | `imp` skill/agents/impeccable-motion-reviewer.md, impeccable-finish-reviewer.md | Apache-2.0 | port | Notice |
| Judge before detector output | `imp` skill/reference/critique.md | Apache-2.0 | rewrite | Notice |
| Three comps, one approval | `imp` skill/reference/visualize.md | Apache-2.0 | rewrite | Notice |
| Signs and fixes (about 70) | `uns` skills/unslop/references/signs.md | CC BY 4.0 | adapt | "unslop by Damir Sokolovsky, CC BY 4.0, adapted" in the notice and in `tells.mjs` header |
| Five-line direction, banned adjectives, template check, one bright element, quiet chrome, accent rule | `uns` skills/unslop/SKILL.md | CC BY 4.0 | adapt | Same credit, changes indicated |
| Generated-design clusters, accent-word and eyebrow tells, "spend boldness in one place" | `fd` skills/frontend-design/SKILL.md | Apache-2.0 (folder LICENSE.txt) | rewrite | Notice |
| Roadmap tells (quote card, dissolve, title hook, fact vs caption) | LaunchClip ROADMAP | own | own | none |

The CC BY credit must travel with any copy: the notice file, the header of
`kit/core/tells.mjs`, and any doc that reprints the signs.
