# RFC: Viral formats, results built in

Status: draft, open for review
Date: 2026-10-28
Builds on: [VIDEO_QUALITY_RFC.md](VIDEO_QUALITY_RFC.md) (profiles, the
direction map, gates), [COLLECTIONS_RFC.md](COLLECTIONS_RFC.md) (recipes,
series, visual history), [SEEDED_STYLES_RFC.md](SEEDED_STYLES_RFC.md) (a look
per project), the concept tournament (`src/concept_tournament.js` and the
skill's cinematic production contract)

## 0. Decision: always on, as skeletons (2026-10-28)

Review settled one question before the build: virality is not a mode, it is
what a good short video is. So nothing here is switched on, and nothing is
called "viral" in the tool:

- A **format** in this RFC ships as a **library skeleton**
  (`kit/core/skeleton-library.mjs`): a rich script skeleton next to the
  script formats' own (`call-out-pas`, `before-after-bridge`, …), with its
  key shot, opening image, share beat, voice tier and packaging. `make`
  picks one automatically when the brief matches a skeleton's own cue;
  `--skeleton <id>` pins one (library or script-format), `--skeleton none`
  keeps the format's own, and a recipe saves it. `launchclip skeletons
  list|show|choose` replaces `launchclip formats`.
- **The short-video rules apply to every video of 90 s or less**, on a
  library skeleton or not: an image (never a title card) at 0 s, a spoken
  share line in the last 40%, concrete visual nouns, five title options. A
  library skeleton adds its key shot.
- The **format gate** ships as the **structure gate** in `finish` and
  `cinematic-check`; `storyboard.json` names `"skeleton"`, not `"viral"`.

The rest of this RFC reads with those substitutions.

## 1. Summary

LaunchClip is free, and its costs are architected down: a local voice, a
procedural sound kit, and paid providers only on explicit opt-in. A free tool
is only worth using if what it makes gets watched, though. Today LaunchClip
reliably makes videos that are *competent*: they pass the retention mechanics
we already enforce (a hook of 18 words or fewer, the promise by 1 s, proof by
3 s, a rehook, a concept tournament scored on scroll stop). Competent is not
the same as likely to travel.

This RFC moves the decisions that make a short video travel out of the
user's head and into the tool:

- A **format** is a proven short-form structure ("$1 a second", "the last
  time", "X vs Y", "if X were Y") as a first-class, versioned object: its hook
  template, beat sheet, key shot, visual grammar, share trigger, voice tier,
  pacing profile and packaging.
- The planner picks a **format and a fresh angle** before the concept
  tournament, and only offers a format the kit can actually render.
- The finish gates check **format compliance**: a concrete first frame, the
  key shot on screen, a share beat, and sound that stays under the voice.
- **Packaging** (title options and the cover) is written and scored with the
  video, not after it.
- In a collection, a format becomes a **recipe**, so a channel can run one
  format across many topics, which is how most short-form channels grow.

None of this calls a paid API. The format library is data; the extra
planning runs in the same model pass `make` or the agent already pays for.

## 2. What two Shorts showed

On 2026-10-27 we made two 9:16 Shorts end to end with the agent skill, as a
test of "would this get a million views?":

- **A2, "How big is a billion?"** (motion graphics). The "$1 a second" hook
  won its tournament, the script was tight, every gate but the strict layout
  check passed. Honest verdict: moderate potential, low as it stood.
- **B1, "The last time"** (character animation). A strong emotional concept;
  the draft was not publishable.

Neither failed on retention mechanics. They failed upstream of the edit, and
each failure is something the tool could have caught:

| What went wrong | Where the tool could have caught it |
| --- | --- |
| A2's topic is one of the most-made explainers on the platform; nothing asked whether the angle was fresh. | An angle step that names the crowded version and moves away from it (§4.2). |
| Both concepts were judged in the session that wrote them. | A judge that sees only anonymous concepts and the format's bar (§4.3). |
| B1's whole format rests on one shot (the parent lifting the child). The rig has no lift pose, so the run quietly cut away from the moment the title promised. | A key shot the kit must be able to render before the format is offered (§3.3). |
| A2's visuals were competent counters and charts: abstract, nothing a viewer could picture. | A rule that the format's beats name concrete, picturable objects; the roadmap's subject inventory feeds it (§4.2). |
| A2 opened on a text card. | A first-frame gate: frame 0 is an image, not a title card (§5). |
| Neither had a deliberate share moment (a twist, an identity line, a call to act). | A required `share` beat in every format (§3.2). |
| B1 is an emotional piece read by a synthetic voice. | A voice tier per format, so the free voice is used where it is fine and a better one is recommended where it matters (§3.5). |
| Counters cued a white-noise riser that rode over the voice, repeated four times. | Fixed in [#351](https://github.com/rogerchappel/launchclip/pull/351) (tonal tallies, a timbre guard, budgets for long cues); a format also names its sound density (§3.4). |

## 3. The model

### 3.1 Format

A format lives in `kit/formats/<id>.json` (built in) or
`.launchclip/formats/<id>.json` / `~/.launchclip/formats/<id>.json` (the
user's own, same lookup order as style packs):

```json
{
  "schema": "launchclip.format.v1",
  "id": "dollar-a-second",
  "title": "$1 a second",
  "version": "2026-10",
  "family": "scale",
  "fits": ["explainer", "finance", "science", "history"],
  "lanes": ["motion"],
  "aspects": ["9:16"],
  "duration": { "min": 20, "target": 30, "max": 45 },
  "profile": "shorts",
  "hook": {
    "template": "I'll {give} you {unit} every {interval}. When {milestone}?",
    "rules": ["second person", "a question the viewer answers wrong", "≤ 14 words"]
  },
  "beats": [
    { "role": "hook", "intent": "a personal stake in one number" },
    { "role": "proof", "intent": "the first milestone lands, smaller than expected" },
    { "role": "rehook", "intent": "keep going to the next order of magnitude" },
    { "role": "escalation", "intent": "the second milestone, far bigger than expected" },
    { "role": "escalation", "intent": "the third, absurd; compared with something the viewer knows" },
    { "role": "share", "intent": "the gap in one line the viewer will repeat" },
    { "role": "cta_or_loop", "intent": "the last line runs back into the hook" }
  ],
  "key_shot": {
    "describe": "a clock or calendar racing while the stake grows beside it",
    "modules": ["count-up", "odometer", "flip-clock", "timeline-ruler"]
  },
  "visuals": {
    "first_frame": "the stake as an object (a coin, a note) or a person receiving it",
    "concrete": true,
    "avoid": ["title card hook", "abstract bar chart without a picturable unit"]
  },
  "share": { "kind": "surprise", "line": "a comparison the viewer can repeat at dinner" },
  "voice": { "tier": "free", "delivery": "fast, amused, conversational" },
  "sound": { "density": "normal", "long_cues": "rare" },
  "packaging": {
    "title_templates": ["{unit} a second: how long until {milestone}?", "Million vs billion is not what you think"],
    "cover": "the two milestones side by side, the gap as the headline"
  },
  "examples": ["How big is a billion, in seconds"],
  "notes": "Works for any scale gap. Weak when the numbers are already famous (the planner must find a fresher unit)."
}
```

- **`family`** groups formats by their engine: `scale` (orders of magnitude),
  `last-time` (the moment you don't know is the last), `versus` (X vs Y),
  `if-were` (if X were Y), `nobody-tells` (the hidden cost), `countdown`
  (ranked list), `before-after`, `myth`, `pov`, `process` (how it's made).
- **`lanes`** says which renderers can make it: `motion`, `character`,
  `footage`, `demo`. A format is offered only in a lane it names.
- **`beats`** extend the story roles the tournament already uses with one
  new role, `share` (§3.2). The retention edit fills them in order.
- **`version`** is a month. Formats age: a format past its review date is
  still usable, but `launchclip formats list` marks it, and the planner
  prefers fresher ones when two fit (§7).
- **`examples`** are titles only. A format never carries or copies anyone
  else's footage, audio, script or design; it describes a structure.

### 3.2 The share beat

Every format has a `share` beat, and the story receipt must fill it. It is
the line that gives a viewer a reason to send the video to someone or to
comment. The kinds:

- `surprise`: a fact that reframes the topic ("twelve days and thirty-two
  years apart").
- `identity`: the viewer recognises themselves ("if you still have a parent
  who picks up when you call…").
- `act`: a small action ("so call him today").
- `debate`: a claim people will argue with, *grounded in the evidence*.
- `useful`: a takeaway worth saving.

Clickbait stays penalised exactly as the tournament penalises it today
(`unsupported_clickbait`); `debate` needs an evidence link like any claim.

### 3.3 The key shot, and feasibility

The key shot is the image the format cannot work without: the parent's last
lift in "the last time", the racing clock in "$1 a second", the split frame
in "X vs Y". It names the modules (or the character poses, sets and actions)
that render it.

Before the planner offers a format it checks the key shot against the kit:

- **Modules** must exist in the catalogue for the lane.
- **Character shots** name the poses, actions and sets they need
  (`"pose": "lift-child"`, `"set": "park"`); the rig's `POSES`, `ACTIONS` and
  `SETS` decide.
- **Footage and demo shots** need the matching asset kind in the inventory.

A format whose key shot the kit can't render is listed as `blocked` with the
reason ("needs pose lift-child"), never offered silently. That list is also
the kit's backlog: "the last time" being blocked on a lift pose is a concrete
reason to add one.

### 3.4 Visual grammar and sound

`visuals` carries three rules the direction map and the gates read:

- `first_frame`: what frame 0 must be. Always a concrete image, never a title
  card or a blank plate.
- `concrete: true`: every beat's `visual_noun` (already in `STORY.json`)
  must name a picturable object. The planner gets the roadmap's subject
  inventory (eight to twelve things only this subject has) and builds the
  beats from it.
- `avoid`: devices that make this format read as generated or generic. These
  join the registry of video tells on the roadmap.

`sound` sets the SFX density and how rare long tonal cues are, on top of the
budgets [#351](https://github.com/rogerchappel/launchclip/pull/351) added.

### 3.5 Voice tier

A format names the cheapest voice that serves it:

- `free`: the local Kokoro voice is fine (data, explainers, lists).
- `better`: a warmer local voice when one is available, else Kokoro with the
  format's delivery notes.
- `human-or-premium`: emotional formats ("the last time", POV) where a
  synthetic read costs the video. LaunchClip still drafts with the free voice,
  and says so in the review step: record the script yourself and supply it as
  the narration (supplied speech is kept byte-for-byte, as today), or opt into
  ElevenLabs for the final take only.

Nothing is spent without opt-in. The tier changes what the tool *recommends*,
and what the critic is told to listen for.

### 3.6 Packaging

The script pass writes `title_options` already; `publish.json` lists them.
Formats add:

- Title templates the script pass fills, plus free-form options, five in all.
- A scoring pass (in the same model call as the retention edit) on curiosity
  gap, clarity at a glance, and match with the first frame. The best title
  goes first in `publish.json`; the rest stay as options.
- A cover brief for `src/cover.js`: the format's cover idea filled for this
  video, so the thumbnail and the opening frame tell the same story.

## 4. Where it plugs in

### 4.1 Choosing a format

`launchclip make "<prompt>"` and the agent skill both gain a step before the
concept tournament:

1. Read the prompt, the lane the router picked, the aspect and duration.
2. List the formats that fit (`fits`, `lanes`, `aspects`, `duration`), with
   the blocked ones and why.
3. Pick one, or take the user's (`--format-id dollar-a-second`,
   `make --format-id auto` is the default). In a collection, the recipe names
   it.

`launchclip formats list [--lane motion] [--fits finance]` and
`launchclip formats show <id>` print the library.

### 4.2 Finding the angle

Before the five concepts, the planner writes `ANGLE.json`:

- `crowded`: how this topic is usually done, in a sentence (the planner's own
  knowledge; no search API is called).
- `inventory`: the subject inventory (eight to twelve concrete things only
  this subject has).
- `angles`: three fresh angles built from the inventory, each in the chosen
  format, each saying how it differs from `crowded`.

The five tournament concepts are then spread across those angles instead of
being five takes on the obvious one.

### 4.3 Judging

The tournament judge gains the format's bar: it scores whether each concept
fills the format's beats, whether the share beat is real, and whether the key
shot is the visual centre. Two changes to how it runs:

- **Fresh context, always.** In `make`, the judge is already a separate model
  call. In the agent skill, the judge must be a subagent that sees only the
  brief, evidence, format and anonymous concepts; a same-context judging pass
  is recorded as such and `cinematic-check` warns on it.
- **New criteria:** `angle_freshness` (weight 12) and `share_strength`
  (weight 10), taken proportionally from `promise_clarity` and
  `audience_fit`, which the format now carries.

### 4.4 Collections

A recipe gains `"format": "<id>"`. A channel running "$1 a second" across 30
topics is one recipe and a topic list. Visual history (already in `make`)
keeps the 30 from looking alike; the format keeps them recognisably one
series.

## 5. Gates

`finish` adds a `format` gate when the story names a format. It reads the
render, the story and the receipts, and fails with the beat or frame at fault:

- **First frame:** frame 0 is not a title card (text area share and the
  module at t = 0 both checked), and the format's `first_frame` module or
  subject is on screen within 0.35 s.
- **Key shot:** a scene renders one of the key shot's modules or character
  actions, and it lands inside the beat the format puts it in.
- **Share beat:** `STORY.json` has a `share` beat with a spoken line and a
  `visual_noun`, inside the last 40% of the runtime.
- **Concrete visuals:** no beat's `visual_noun` is a bare abstraction
  ("growth", "the gap") unless it names the object that shows it.
- **Packaging:** `publish.json` has five title options with scores, and the
  cover brief was used.
- **Voice tier:** a `human-or-premium` format finished on the free voice
  passes with a warning that names the cheapest fix; it never blocks a draft.

Like every gate, these report, and the critic and repair loop act on them; a
format gate never weakens to pass.

## 6. Starter library

Ten formats ship in phase 1, chosen to cover the lanes LaunchClip renders
today. Each is written from structure, not from any one video:

| id | family | lanes | share | key shot |
| --- | --- | --- | --- | --- |
| `dollar-a-second` | scale | motion | surprise | a clock racing beside a growing stake |
| `if-it-were` | scale | motion | surprise | the thing rescaled into a familiar one (if Earth's history were a day) |
| `versus` | versus | motion, demo | debate | a split frame that resolves to one side |
| `nobody-tells` | nobody-tells | motion, footage | useful | the hidden cost revealed under the known one |
| `countdown` | countdown | motion | useful | the number one reveal, held back to the end |
| `myth-check` | myth | motion, footage | surprise | the myth stamped, then overturned |
| `last-time` | last-time | character | identity → act | the ordinary moment that turns out to be the last (needs a lift pose: blocked until it exists) |
| `pov` | pov | character | identity | the viewer's own situation, shot from their eyes |
| `before-after` | before-after | demo, footage | useful | the same frame, before and after |
| `how-its-made` | process | footage, motion | useful | the one step people never see |

## 7. Keeping formats honest

- **Formats age.** A structure that works this year gets copied into noise.
  Each format has a `version` month and a review date six months on. The
  library is data in the repo, so updating a format is a normal PR.
- **No guarantees.** The tool raises the floor and the hit rate; it cannot
  promise views. The docs and the review step say so plainly.
- **No copying.** Formats describe structure. `examples` are titles. The
  existing rule stands: references may guide pacing and structure, never
  supply footage, audio, likeness, branding or exact design.
- **Grounded claims.** Formats don't relax the evidence rules. A `surprise`
  or `debate` share line needs an evidence link like any other claim.

## 8. Learning from results (later)

Once a user publishes, the most useful signal is their own: retention at
3 s, average view duration, shares. A later phase reads it, opt-in, from the
platform's own analytics export (a CSV the user downloads; no account access
or upload by LaunchClip), and records per video: the format, the angle, the
first frame, the share beat and the numbers. Over a collection, that tells
the user which formats work *for their audience*, and the planner prefers
them. It stays local, per collection.

## 9. Cost

Everything here runs inside passes that already exist:

- The format choice and the angle are part of the planning call `make`
  already makes (or the agent's own reasoning in the skill).
- Title scoring is part of the retention edit.
- The gates are local measurements on the render.
- The only new spend is optional: a premium voice for a `human-or-premium`
  final, on explicit opt-in, as today.

## 10. Phases and PRs

1. **Format schema and starter library.** `kit/formats/`, the loader with
   project and user overrides, `launchclip formats list|show`, feasibility
   against the kit (blocked formats with reasons). No behaviour change yet.
2. **Planning.** The format step and `ANGLE.json` in `make` and in the skill;
   the tournament's format bar and the two new criteria; fresh-context judging
   required in the skill.
3. **Gates.** The `format` gate in `finish` and `cinematic-check`; the share
   beat in `STORY.json`; concrete visual nouns.
4. **Packaging.** Title templates and scoring; the cover brief to
   `src/cover.js`; `publish.json` ordered by score.
5. **Collections.** `format` in recipes; series checks with visual history.
6. **Kit backlog from blocked formats.** Starting with the lift pose and a
   closer, more expressive face framing for emotional character formats.
7. **Results (later).** The opt-in analytics import of §8.

Each phase ships on its own, with tests, and leaves stories without a format
working exactly as today.

## 11. Open questions

- **How many formats?** Ten to start. Should users be able to publish their
  own to a shared list, or is a PR to the repo enough?
- **Freshness without search.** `crowded` comes from the model's knowledge,
  which goes stale. Is an optional, user-supplied list of competing titles
  (pasted in) enough, or do we want an opt-in search later?
- **Format and style together.** Should a format suggest style constraints
  (the seeded style's tone, theme), or stay independent of the look?
- **Long form.** Formats here are Shorts-first. Long-form has its own
  structures (cold open, chapters, payoff); a separate set, or the same schema
  with `aspects: ["16:9"]` and longer beats?
- **The critic's ear.** The voice tier tells the critic what to listen for;
  should a `human-or-premium` format's critic score the read itself, and how,
  without a paid model?
