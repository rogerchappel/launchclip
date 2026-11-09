# RFC: Animation from one prompt

Status: draft for review; scope and decisions settled by the owner (2026-11-10)
Date: 2026-11-10
Builds on: [VIDEO_QUALITY_RFC.md](VIDEO_QUALITY_RFC.md) (§6.3 narrative maps, §10.5 character narratives),
[STORYBOARD_ENGINE_RFC.md](STORYBOARD_ENGINE_RFC.md) (the storyboard contract),
[MAKE_SKILL_PARITY.md](MAKE_SKILL_PARITY.md) (one quality bar for both paths),
[LONG_FORM_MAKE_RFC.md](LONG_FORM_MAKE_RFC.md) (resumable stages),
[DUAL_RENDERER_PLAN.md](DUAL_RENDERER_PLAN.md) (two renderers, one contract),
[COLLECTIONS_RFC.md](COLLECTIONS_RFC.md) (collections and series),
[KIT_CONTRACTS.md](KIT_CONTRACTS.md) ("Character modules", "Saved characters")

## 1. Summary

The goal is a character animation people want to watch, made from one prompt:
a 30–60 second Short first, longer pieces later. It must work two ways: led
by an agent on the user's own AI subscription (the create-video skill), and
fully built in (`launchclip make`).

**The scope rule.** LaunchClip's own pictures are drawn in code. It does not
generate images or video, and it does not call a service that does. Footage,
background plates and character art made elsewhere are bring-your-own: the
user or the app that runs LaunchClip makes them and hands them in as assets.
Hosting, scale, servers and job APIs belong to that app, not to LaunchClip.

So there is **one render path, the code-drawn rig**, and a **hand-in
contract** for art made elsewhere. AI still does the creative work: a model
is the writer, the cast and world designer, the director and the critic, on
both routes.

Most of the parts exist. What is missing is the pipeline that joins them.

What exists today:

- A code-drawn character kit: one rig, a starter cast, generated casts,
  drawing styles, named poses, expressions and acting cues, sets, and two
  modules, `cast-scene` and `character-cameo` (`kit/core/characters/`,
  `kit/core/catalog-characters.mjs`).
- Saved characters: `launchclip cast create` and `cast edit` write one
  designed character to a file, `launchclip.character.v1`
  (`kit/core/characters/character.mjs`, `src/cast_design.js`,
  `src/character_store.js`).
- Illustrated characters: `sprite-scene` plays a folder of pose sprites over
  a painted plate (`kit/core/catalog-sprites.mjs`). Today `launchclip cast
  sprites` can draw those sprites with a built-in image adapter
  (`openaiImageAdapter` in `src/sprite_cast.js`); under the scope rule that
  adapter goes, and the command takes one from the host (phase 10).
- Narrative direction maps: story beats, cast cues and a key action per line
  (`kit/core/direction.mjs`).
- Dialogue in several voices, with every word tagged with its speaker
  (`src/voice/dialogue.js`).
- Gates for character stories: cast, physics, acting, ghosting, density,
  variety, holds and states (`src/cast.js`, `src/direction_guardrails.js`,
  `src/movement_guardrails.js`, all run by `src/finish.js`).
- A critic that sends its findings back to the planner and re-renders only
  the scenes that changed (`src/make/critic_repair.js`).
- A hook that lets an app supply real media for a scene, with a clean "no
  shot" answer (`src/asset_provider.js`, `src/asset_provider_cmd.js`).

What is missing:

- **`make` cannot write a story with dialogue.** Its script pass writes one
  narration and forbids speaker labels (the prompt in `src/make/script.js`).
- **Nothing freezes the cast, world and style before shots are planned.** The
  planner binds a cast while it plans (`src/cast_fit.js`), so a replan can
  change who is in the story.
- **Nothing checks handed-in art against the story's characters.** The cast
  gate checks rig parameters, which only works for shots the rig drew.
- **With only an Anthropic key, `make` has no critic.** Its Anthropic
  adapter sends text only (`src/make/models.js`).

This RFC adds one pipeline with fixed file contracts, the hand-in contract,
a check of which model roles this machine or account can play, and a
delivery plan that starts with a vertical slice.

## 2. Goals and non-goals

Goals:

- One prompt to a finished 30-second Short with two characters who talk,
  drawn in code, with the critic loop. No key beyond a language model.
- One set of contracts for both routes. The routes differ only in who plays
  each role.
- Art made elsewhere can replace a plate, a character's drawing or a whole
  shot. It is validated and checked against the show bible first.
- A missing or rejected asset never fails the video. The code-drawn version
  plays, and the report says so.
- Every stage resumes. A rejected shot costs one shot.
- Easy to drive from another program: files in, files out, clear exit
  codes, progress on stderr, and no server.

Non-goals are in §12.

## 3. The pipeline at a glance

| # | Stage | Writes | Model work | Exists today |
|---|---|---|---|---|
| 1 | Writers' room | `SCRIPT.json` | premise, loglines, script | narration only |
| 2 | Show bible | `BIBLE.json`, `bible/sheets/` | cast and world design | parts: saved characters, `story.cast`, sheets |
| 3 | Voice | `NARRATION.json` | none (local voices) | yes |
| 4 | Shot list | `DIRECTION.json`, `storyboard.json` | direction map, then storyboard | yes, extended here |
| 5 | Animatic | `renders/animatic.mp4`, `ANIMATIC.json` | a staging review | yes (it is a draft `finish`) |
| 6 | Hand-in (optional) | `qa/hand-in.json` | a vision check | no |
| 7 | Sound and finish | `AUDIO-MANIFEST.json`, `renders/draft.mp4` | none | yes |
| 8 | Critic and retakes | `qa/critic.json`, `qa/retakes.json` | a vision model | yes, extended here |

Three rules hold the pipeline together:

1. **The bible is frozen before the shot list.** Later stages read it and
   never write it. A change to the bible is a new bible.
2. **The animatic locks the timing.** Every shot is drawn by the rig, at its
   real length, against the real voice. Handed-in art may change how a shot
   looks. It may not change how long it runs.
3. **The storyboard always describes the code-drawn version of every shot.**
   So the fallback is always renderable, and with nothing handed in, the
   animatic at delivery quality is the video.

Voice comes before the shot list, as it does today, because scenes and cues
are anchored to measured words (`word:<text>` anchors, resolved in
`kit/core/story.mjs`).

## 4. Stage contracts

Each contract is a versioned JSON file in the project folder. Each has one
writer and one validator, and each records the hash of what it was made from,
so a rerun reuses it while its inputs are unchanged. This is how `make`
resumes today (the header of `src/make/index.js`).

### 4.1 Story and script: `SCRIPT.json`, grown

`make` already writes `SCRIPT.json` (`launchclip.make-script.v1`: a title,
one `narration` string and its `beats`; `src/make/script.js`). That file
grows; no second file is added beside it. The new version adds speakers and
silent lines:

```json
{
  "schema_version": "launchclip.make-script.v2",
  "title": "She skipped one check",
  "logline": "Maya's deploy fails again; Sam shows her the one check she skipped.",
  "premise": { "want": "ship before lunch", "obstacle": "the same failing deploy", "change": "she checks first" },
  "characters": [
    { "id": "maya", "role": "lead", "want": "to ship", "speech": "short, dry" },
    { "id": "sam", "role": "foil", "want": "to help without gloating", "speech": "warm, unhurried" }
  ],
  "beats": [
    { "beat": "setup", "place": "desk-laptop",
      "lines": [
        { "id": "l1", "speaker": "narrator", "text": "Maya has shipped this fix three times today." },
        { "id": "l2", "speaker": "maya", "text": "Third time.", "playing": "flat, to herself" },
        { "id": "l3", "speaker": "sam", "text": "Did you run the check?", "playing": "gentle" },
        { "id": "l4", "speaker": null, "action": "Maya turns to look at him.", "seconds": 1.2 }
      ] }
  ],
  "narration": "Maya has shipped this fix three times today. Third time. Did you run the check?",
  "title_options": ["She skipped one check"]
}
```

- A line is spoken (`speaker` is a character id or `"narrator"`) or silent
  (`speaker: null` with an `action` and a length). Silent lines are where
  acting happens.
- **A narrated script is the case where every speaker is the narrator.** A
  v1 file reads as that, so nothing written today breaks. `narration` stays
  as the spoken text joined in order.
- `beats[].beat` is one of the narrative beats the direction map already
  uses: `setup`, `problem`, `attempt`, `turn`, `resolution`, `cta`
  (`NARRATIVE_BEATS` in `kit/core/direction.mjs`).
- `playing` is a note for the acting and the voice. It is never spoken.
- `characters` are roles, wants and ways of speaking. How a character looks
  belongs to the bible.
- **Default shape: a narrator with dialogue.** The narrator carries the
  story and the characters speak the turns. Pure dialogue is allowed, and
  the brief can ask for it.

**Writer.** The writers' room. Three steps, each small: a premise from the
prompt; three to five loglines judged in a fresh context, as the skill
judges concepts today (step 2 of `skills/launchclip-create-video/SKILL.md`);
then the script on a skeleton. Two library skeletons are already character
stories, `last-time` and `pov` (`kit/core/skeleton-library.mjs`). On the
skill path the agent writes the same JSON, and tooling renders `SCRIPT.md`
from it for reading.

**Validator.** A new `kit/core/screenplay.mjs`:

- every speaker is a listed character or the narrator, and every listed
  character speaks or acts;
- the spoken word count fits the target length at the voice's measured pace;
- the problem lands inside the profile's `problem_lands_seconds`
  (`kit/profiles/story-characters.json`);
- every spoken line passes today's script checks (`src/script_check.js`);
- facts, numbers and product claims follow the evidence rules, as §10.5 of
  the quality RFC requires.

**Derived by tooling.** The spoken lines become `audio.narration.lines:
[{speaker, text}]`, the dialogue format `src/voice/dialogue.js` already
voices. Silent lines become gaps of their length. No voice code changes.

### 4.2 The show bible: `BIBLE.json`

```json
{
  "schema": "launchclip.show-bible.v1",
  "frozen": true,
  "hash": "sha256:…",
  "cast": {
    "style": "outlined",
    "characters": [
      { "id": "maya", "voice": "af_heart", "position": "left",
        "character_file": "cast/maya.character.json",
        "sheet": "bible/sheets/maya.png", "fingerprint": "…",
        "must_keep": ["curly dark hair", "teal hoodie", "round glasses"] }
    ]
  },
  "world": { "kind": "office", "time": "day", "sets": ["desk-laptop", "standing"] },
  "style": { "pack": "styles/project.json", "seed": 4821, "drawing_style": "outlined" },
  "rules": ["Sam never raises his voice."],
  "inputs": { "script_hash": "…" }
}
```

- `cast` is exactly the `story.cast` shape ("Story cast" in
  KIT_CONTRACTS.md), with four additions per character: the saved character
  file it came from, its reference sheet, its fingerprint, and `must_keep`.
- **Every character has rig parameters**, even when art for it will be
  handed in. The rig draws the animatic and is the fallback.
- `must_keep` is the short list of features a viewer would notice changing.
  Tooling writes it from the rig parameters (hair, skin tone, outfit,
  glasses, headwear, mobility aid). The hand-in check reads it (§5.4).
- `world` names a world and the sets the story may use
  (`kit/core/catalog-world.mjs`, `kit/core/characters/sets.mjs`).
- `style` points at the project's style pack and seed
  ([SEEDED_STYLES_RFC.md](SEEDED_STYLES_RFC.md)).

**Reference sheets.** One PNG per character: every pose and expression the
script could call for, and a face close-up, in the bible's drawing style. It
is drawn with the modules' own view tree, as `launchclip cast sheet` draws
the story sheet (`castSheet` in `src/cast.js`) and `cast create` draws a
saved character's sheet (`src/cast_design.js`). So the sheet is the
character, not a description of it.

**Writer.** The bible stage, with the model as cast and world designer:

- For each role in the script it picks a saved character, a starter, or
  designs a new one. A new design goes through the same door as `cast
  create`: the model answers with set paths, and the answer is validated
  against the rig's own options, so it can only choose what the rig can draw
  (`src/cast_design.js`).
- It gives each speaking character a different voice.
- It picks the world, the sets and the drawing style.
- Tooling then renders the sheets and writes the hash.

**Validator.** A new `kit/core/bible.mjs`:

- `storyCastErrors` and `resolveStoryCast` pass (`kit/core/characters/cues.mjs`);
- every script character has an entry, a voice and a sheet on disk;
- every set and world exists;
- the hash matches the content.

**Frozen means pinned.** Once frozen, `story.cast` is copied from the bible
and reset if a model changes it. The planner already pins a bound cast this
way (`fixed.cast` in `src/storyboard_planner.js`). A new `bible` gate in
`finish` fails when `story.cast` and the bible disagree.

**Reference images map to traits, never to a likeness.** A user may give
pictures to steer a character or a style. They are read for traits (a
silver bob, round glasses, a line style) that the rig and the style can
express. A real person's name or photo is never turned into a likeness; the
character designer already refuses that and asks for traits
(`kit/core/characters/describe.mjs`).

**Inputs from other work.** Saved characters and `cast create` / `cast
edit` are on `main`. Local branches add acting profiles, more drawing styles
(`chibi`, `chibi-plain`), a larger starter cast, and drawing-trait analysis
in `style create --from-reference`. The bible uses whatever the kit offers
when it runs, by id. It does not depend on any of those landing.

### 4.3 The shot list: `DIRECTION.json` and `storyboard.json`

There is no new shot-list file. **A shot is a track-0 character scene in
`storyboard.json`**, and the direction map says why it exists. Both files
grow by small, additive fields.

`DIRECTION.json` (`launchclip.direction-map.v1`):

- `bible: {file, hash}` at the top level. `validateDirection` rejects
  unknown top-level fields today (`kit/core/direction.mjs`), so this is a
  small code change.
- A line may carry `line: "l3"`, the script line it plays. The word range
  stays the source of truth for timing.
- New validation for a narrative map: while a character speaks, a scene with
  that character is on screen, unless the line says why not (`why: "we stay
  on Maya's reaction"`).

Everything else a shot needs is already in the map: the beat on the section,
`cast` cues, `set`, and the key `action` every line with cast cues must name
(`validateDirection`).

`storyboard.json` (`launchclip.story.v1`):

- `bible: {file, hash}` at the top level. It is a new key in `TOP_LEVEL` and
  a bump of `STORY_REVISION` (`kit/core/story.mjs`).
- Nothing else. A scene does not say whether art will be handed in for it;
  the hand-in file does (§5).

**Writer.** The model as director: the planner in `make`, the agent in the
skill, in the order both paths already use: the direction map first, then
the storyboard against it (quality RFC §6.4).

**Validator.** `launchclip story validate`: the checks it runs today plus
the bible reference. A new `launchclip story shots <project> [--json]`
prints the shot list: id, time, frames, who, set, framing, the lines spoken,
and the poses each character takes. It is a view of the two files, for a
person or an agent to review and for a host to plan hand-in from (§5.3).

### 4.4 The animatic: `ANIMATIC.json`

The animatic is the whole story drawn by the rig at draft quality, with the
real voice and captions. It is `launchclip finish` on the storyboard,
written to `renders/animatic.mp4`.

```json
{
  "schema": "launchclip.animatic.v1",
  "story_hash": "…", "bible_hash": "…", "video": "renders/animatic.mp4",
  "shots": [ { "id": "s3", "start": 6.4, "end": 10.1, "frames": 111, "segment": "…" } ],
  "gates": { "cast": "passed", "acting": "passed", "physics": "passed" },
  "review": { "verdict": "ship", "file": "qa/animatic-critic.json" }
}
```

**Writer.** `finish`. **Validator.** Its own gates. Every blocking gate must
pass on the animatic. The critic reviews it for story, staging and acting
only, which are cheap to fix here.

With nothing handed in, the animatic rendered at delivery quality is the
video, and stage 6 does nothing.

### 4.5 Hand-in: `HANDIN.json` and `qa/hand-in.json`

`HANDIN.json` is written by whoever hands art in: the user, the agent, or
the app running LaunchClip. `qa/hand-in.json` is LaunchClip's answer: what
was used, what was rejected and why. Both are specified in §5.

### 4.6 Sound

No new contract. The existing ones cover it:

- `NARRATION.json`: words, each with its speaker, plus lines and gaps
  (`src/voice/dialogue.js`).
- The sound score planned from what the storyboard does and says
  (`src/sfx/score.js`), the music choice (`src/music/index.js`), the mix and
  the −14 LUFS master, recorded in `AUDIO-MANIFEST.json` (`src/finish.js`).

Two additions:

- **Mouth shapes from phonemes.** The rig opens and closes mouths on word
  timings (`kit/core/characters/acting.mjs`). Kokoro already reports a
  duration for every phoneme, which `src/voice/kokoro.js` folds into word
  times. Keeping those phonemes in `NARRATION.json` gives the rig real mouth
  shapes at no cost. That is the lip-sync bar for the first release.
- **Sound follows retakes.** The score is planned from the storyboard, so a
  retake that changes a scene's cues re-plans that scene's sounds.

A handed-in clip's own audio is never used. The story's voice and score
play over it.

### 4.7 Critic verdicts and retakes: `qa/critic.json`, `qa/retakes.json`

`qa/critic.json` keeps its format: a verdict of `ship`, `repair` or
`replan`, and findings that cite evidence ids (`src/make/critic.js`).
Findings already map to scenes through the evidence manifest
(`findingScenes` in `src/make/critic_repair.js`), and a shot is a scene, so
findings already name shots.

Changes to the review:

- The critic is shown each character's reference sheet beside the frames.
- Two finding categories from the quality RFC (§11.3) are used: `acting` and
  `character-consistency`.
- A new category, `lip-sync`, for a mouth that does not match its line.

`qa/retakes.json` (`launchclip.retakes.v1`) records each round: the
findings, the shots they name, what was tried, and whether the round was
kept. **A retake fixes the smallest failing shot**, by the cheapest step
that could work:

| Step | What changes | Costs |
|---|---|---|
| 1. Redirect | that scene's cues, framing or set | a planner repair and one scene's render |
| 2. Drop the hand-in | that shot's handed-in art, if the finding is about it (§5.5) | one scene's render |
| 3. Replan the beat | the scenes of one story beat | a planner call and those scenes' renders |

LaunchClip cannot remake handed-in art. A finding about it is reported in
`qa/hand-in.json` with the shot, so whoever made the art can make it again.

A round that does not lower the blocking and major findings is undone, as
today (`criticImproved`, `snapshotRound` and `restoreRound` in
`src/make/index.js`). The limit stays three rounds (`MAX_CRITIC_REPAIRS`;
"at most three passes" in the skill). After three, the result is
`needs-repair`, and it is reported, not delivered as finished.

## 5. One render path, and the hand-in contract

### 5.1 The render path

Every shot is drawn by the code-drawn kit, in either renderer. A character
cannot drift on this path: scenes name characters by id and never carry
parameters, and `castConsistency` checks it (`kit/core/characters/cues.mjs`).
Timing is exact, acting follows the cues exactly, and the render is cached
by segment (`src/render_segments.js`).

Captions, cards, the brand frame and any real screen capture are always
drawn in code, with or without hand-in. A set's screen plays the user's own
capture and never an invented UI (`kit/core/characters/sets.mjs`).

### 5.2 What can be handed in

| Kind | Replaces | Already in the kit | Cast still acts in code |
|---|---|---|---|
| **Plate** | the code-drawn room or world behind the cast, for one place | a cast scene rides any track-0 plate, a photo among them ("Riding a plate" in KIT_CONTRACTS.md) | yes |
| **Sprite cast** | how the characters are drawn, for the whole video | `sprite-scene` and its sprite folders (`kit/core/catalog-sprites.mjs`) | pose swaps, talk and blink only |
| **Whole shot** | the picture of one shot | the `clip` module; `assets/shots/` (`SHOTS_DIR` in `src/asset_provider.js`) | no: the clip is the acting |

Sprite casts stay their own form and are the main hand-in path for
character art. They keep the most of what LaunchClip is good at: code still
times the poses, the mouths and the blinks to the voice.

What hand-in is not: LaunchClip does not ask a model to make these assets,
does not export control passes for a model to follow, and does not know or
care how they were made.

### 5.3 How assets are handed in

**When.** After the animatic. By then the shots, their exact lengths, the
poses each character takes and the lines spoken in each shot are fixed.

**What the maker needs.** `launchclip story shots <project> --json` (§4.3)
plus the bible and its sheets is the whole brief. For each shot it gives
the frame count, rate and size, who is in it and where, the place, the
poses used, and the spoken lines with their word times, so a mouth can be
matched to the voice elsewhere. `ANIMATIC.json` names each shot's rendered
segment as a timing reference.

**The manifest.** Files go under `assets/`, and `HANDIN.json` says what
each is for:

```json
{
  "schema": "launchclip.hand-in.v1",
  "bible_hash": "sha256:…",
  "cast": [
    { "character": "maya", "art": "assets/cast/maya",
      "source": { "made_with": "…", "licence": "…", "generated": true } }
  ],
  "places": [
    { "place": "desk-laptop", "plate": "assets/plates/office.png",
      "floor": 0.82, "light": { "dir": 125 }, "source": { "made_with": "…", "licence": "…" } }
  ],
  "shots": [
    { "shot": "s3", "clip": "assets/shots/s3.mp4", "source_start": 0,
      "source": { "made_with": "…", "licence": "…", "generated": true } }
  ]
}
```

- A sprite folder follows the existing layout: `<pose>.png`, `<pose>-talk.png`
  and `<pose>-blink.png`, transparent, all the same size and framing
  ("Sprite casts" in KIT_CONTRACTS.md). Pose names are the rig's pose names,
  so the code-drawn scene and its sprite form line up.
- A plate is per place, not per shot, so one room looks the same in every
  shot. `floor` is where the ground sits, as a share of the height, and
  `light` is where the light comes from, so the cast stands on the floor and
  is lit from the right side (`params.light` on `cast-scene`).
- A whole shot names the shot it replaces. `source_start` picks where in a
  longer clip it begins.
- `source` is the provenance: what made it, under what licence, and whether
  it was generated. It is required.

**Two ways to deliver it:**

1. **Files.** Write the assets and `HANDIN.json` into the project and run
   `launchclip finish` (or `make` again; it resumes).
2. **The asset-provider hook.** An app already answers shot requests through
   `findShot(request) → shot | null`, in code or as its own command speaking
   one JSON line per request (`--asset-provider-cmd`,
   `src/asset_provider_cmd.js`). Character shots and plates are asked for
   through the same hook, with the fields above added to the request. `null`
   means "draw it in code", exactly as it means "design it without a shot"
   today.

**Stories planned for sprites from the start** keep working as they do now:
a cast with `art` entries and `sprite-scene` scenes in the storyboard. The
hand-in contract adds validation and the bible check to them.

**How a sprite cast is applied.** A new compile step turns each code-drawn
cast scene into its `sprite-scene` form in the resolved copy of the story:
the same characters, sides, pose cues and spoken ranges, over the place's
plate. The user's `storyboard.json` is not rewritten. `finish` never
rewrites it; it renders a resolved copy (`src/finish.js`).

### 5.4 Validation and the bible check

`launchclip handin check <project> [--json]` runs both. `finish` runs the
same code before it renders. Nothing is rendered from an asset that fails.

**Validation: measured, no model.**

| Kind | Checks |
|---|---|
| All | the file exists, is under `assets/`, decodes, and has its `source`; the manifest's `bible_hash` is the frozen bible's |
| Plate | fits the story's size and aspect; holds still enough and is dark or light enough for captions to read, measured as backdrop footage is today (`measureFootage` in `src/asset_provider.js`); `floor` is inside the frame |
| Sprite cast | a sprite for every pose the storyboard uses, with its talk and blink versions; all one size; a transparent background; the figure the same height and on the same foot line in every pose; a talk or blink sprite differs from its pose only around the mouth or eyes |
| Whole shot | the story's size and rate; at least the shot's frame count from `source_start`; not a frozen picture |

**The bible check.**

1. **Measured.** The character's own hair, skin and clothing colours are
   present in its sprites (`kit/core/oklch.mjs` has the colour maths). For a
   whole shot the same test runs over the frame, which is weaker, because
   LaunchClip does not know where the character is in someone else's clip.
2. **A vision judge.** The critic's model is shown the character's sheet
   beside the sprites or a strip of the clip's frames, and answers a
   structured checklist built from `must_keep`: same hair, same skin tone,
   same glasses, same headwear, same mobility aid, same outfit, anyone
   extra in frame. For a plate: it is the bible's place, nobody is in it,
   and it has no lettering baked in.

Results go to `qa/hand-in.json` and a `hand-in` gate:

```json
{ "schema": "launchclip.hand-in-report.v1",
  "look": "code-drawn",
  "assets": [
    { "kind": "sprite-cast", "character": "sam", "status": "rejected",
      "reason": "no sprite for pose \"lean-in\"; the story uses it in s4" },
    { "kind": "plate", "place": "desk-laptop", "status": "used" } ] }
```

Three honest limits:

- **Passing the check does not prove a character reads as the same person
  to a viewer.** It catches gross failures. The critic's
  `character-consistency` category and human review remain the real test.
- **Without a vision model the judge cannot run.** The measured checks still
  do. The asset is used, the judge is recorded as `not-checked` with a
  reason, never as `passed`, and the video is `ready-for-review`. The face
  gate behaves the same way with no face data (quality RFC §11.2).
- **`must_keep` protects what must not be erased.** The generated casts
  include faith headwear, mobility aids and the whole range of skin tones on
  purpose (`kit/core/characters/generate.mjs`). Art that drops a headscarf
  or lightens a skin tone is rejected, with no override.

### 5.5 Fallback, and one look per video

- **A missing or rejected asset falls back to the code-drawn version.** The
  storyboard already describes it and the animatic already rendered it, so
  the fallback costs one render and no planning.
- **A video has one look.** A Short that cuts between two ways of drawing
  the same person looks broken. So:
  - a sprite cast is used only when every character in the story has one
    that passes; otherwise every character is drawn by the rig;
  - whole shots are used only when every character shot has one that
    passes; otherwise every shot is code-drawn;
  - a place uses its plate in every shot or in none.
  `--look mixed` allows per-shot fallback for people who want it.
- **The report names the look and every asset's fate**, and `handin check`
  exits non-zero when anything was rejected, so a host can decide whether
  to remake the art or accept the code-drawn video.
- **Caching.** A handed-in file's content hash joins the hash of the
  segments that show it, as every referenced asset's does already
  (`src/render_segments.js`). Replacing one sprite re-renders the scenes
  that use that character. Editing a caption re-renders nothing handed in.

### 5.6 What is unproven

- **Lip sync on a handed-in whole shot.** LaunchClip gives the maker the
  word times and checks nothing about the result beyond the critic's eye.
- **Acting in sprite form.** `sprite-scene` swaps poses; it does not turn a
  head toward a target or walk a character across a floor. The acting gate
  can check that a pose happened, not that it reads. Stories that lean on
  looks and walks will be weaker in sprite form.
- **Standing drawn characters on a painted plate.** `floor` and `light` are
  two numbers. Whether that is enough for the cast to look like it belongs
  in the picture needs a prototype (phase 11).
- **The measured colour check on whole shots.** It may reject good art or
  pass bad art. Its thresholds must come from fixtures, not guesses.

## 6. Two routes, one set of contracts

### 6.1 Who plays each role

| Stage | Role | Skill path: the agent | `make`: the stage and what it calls |
|---|---|---|---|
| Model check | | runs `launchclip doctor --models --json` | `stageModel` (`src/make/index.js`) |
| Writers' room | writer | writes the premise; judges loglines in a fresh context; writes `SCRIPT.json`; runs `launchclip script check` | new `prepareAnimation` in `stagePrepare`: three structured calls and one repair pass, on the client from `createMakeClient` |
| Show bible | cast and world designer | designs characters with `launchclip cast create` / `cast edit`; writes `BIBLE.json`; runs `launchclip bible freeze`; looks at the sheets | new `stageBible`: one structured call for cast and world, then tooling |
| Voice | | `launchclip voice <project>` | `synthesizeNarration` through the dialogue module, as today |
| Shot list | director | writes `DIRECTION.json`, then `storyboard.json`; `launchclip story validate`; `launchclip story shots` | `stageStoryboard`: `planDirection`, then `planStoryboard`, with the bible pinned (`src/storyboard_planner.js`) |
| Animatic | critic (staging) | `launchclip finish <project> --animatic`; reviews it | new `stageAnimatic`: `runFinish` at draft quality, then the critic on staging |
| Hand-in | critic (judge) | `launchclip handin check <project>` | the asset-provider hook, then the same check, inside `stageFinish` |
| Sound and finish | | `launchclip finish <project>` | `stageFinish`, unchanged |
| Critic and retakes | critic | a fresh-context critic writes `qa/critic.json`; the agent repairs the smallest shot, three passes at most; `launchclip cinematic-check` | `stageCritic` and `criticRepairs`, with the retake steps of §4.7 |

Today's `make` stages are `model`, `inventory`, `demo`, `route`, `prepare`,
`storyboard`, `subject`, `finish` and `critic` (`runMake` in
`src/make/index.js`). The animation path adds `bible` and `animatic`, and
skips `demo` and `subject` unless assets call for them.

**Routing.** Animation is not a new lane. It is the `motion` lane with a
cast, which is how the `story-characters` profile already matches
(`"lanes": ["motion", "voiceover-motion"], "cast": true` in
`kit/profiles/story-characters.json`). `make` already spots a character
brief from its words to pick a skeleton (`skeletonMedium` in
`src/make/index.js`). The router (`src/make/routing.js`) gains `format:
"animation"`, set by that test or by `--animation`. The report gives the
reason, as it does for every route.

**The skill stays the reference.** The agent directs and judges with its
own model, and LaunchClip's metered stages are not run (the cost boundary
in `skills/launchclip-create-video/references/workflow.md`). Every command
in the skill column is local tooling with no model call. The character
design skill that shipped with saved characters
(`skills/launchclip-character-design/`) is the designer's reference.

**One source for prompts and vocabulary.** The beat names, intents, poses,
actions and sets both paths may use come from the kit (`NARRATIVE_BEATS`,
`ACTION_VERBS`, `kitCapabilities()`). The skills' references are generated
from the same registry and checked for drift (`npm run skills:check`). The
script and bible references are generated the same way.

### 6.2 The model check

`launchclip doctor --models [--json]` answers: with these keys and this
machine, which roles can a model play?

```json
{
  "schema": "launchclip.model-access.v1",
  "text": { "available": true, "source": "ANTHROPIC_API_KEY", "provider": "anthropic", "local": false },
  "vision": { "available": false, "reason": "the Anthropic adapter sends text only" },
  "roles": {
    "writer": "available", "designer": "available", "director": "available",
    "critic": "pending: no vision model", "hand-in judge": "pending: no vision model"
  }
}
```

It reports model access, text and vision. It does not report generation,
because LaunchClip does none. It extends what the code already detects:

- **Keys** come from the environment and `.env` files only (`loadCliEnv` in
  `src/env.js`). `doctor` already reports `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY` (`src/doctor.js`). The
  language-model routes also read `OPENROUTER_API_KEY`,
  `OPENAI_COMPATIBLE_API_KEY` with its base URL, and `OLLAMA_BASE_URL`
  (`src/model_provider.js`).
- **Vision** is known per client: `createMakeClient` returns `vision`. It is
  false for the Anthropic adapter and for Ollama, whose client builds its
  messages without images (`src/make/models.js`, `src/model_provider.js`).
- **A local model** is an Ollama address that answers
  (`OllamaStructuredClient` in `src/model_provider.js`).

The check makes no paid call. On the skill path the agent is the text and
vision model, so `--agent` reports every role as the agent's.

**Vision for the Anthropic adapter.** Image input is added to the existing
Anthropic planner client
(`AnthropicPlannerClient` in `src/storyboard_planner.js`), so one Anthropic
key gives the critic and the hand-in judge, and no second key is needed.

`make` writes the result into `MAKE.json` as `model_access`, so an app can
show what a run will and will not check before it starts.

### 6.3 Stopping for approval

The bible and the animatic are the two cheap places to change your mind:
before any shot is planned, and before the delivery render.

- **Attended** (a terminal): `make` stops after each, shows what to look at
  (the sheets; the animatic), and asks. The demo stage already works this
  way: a yes on a TTY, or a flag (`src/make/demo.js`).
- **Headless**: `make` continues on the critic's word. `--stop-after bible`
  or `--stop-after animatic` makes it stop instead, with status
  `awaiting-approval` and the review as the next step. Running again with
  `--approve bible` (or `animatic`) resumes from there; every earlier stage
  is reused.
- **The skill path**: the agent shows the user the sheets and the animatic
  at the same two points.

## 7. Running locally and from a host

**Everything in this pipeline runs on one machine.** Planning can run on a
local model through Ollama. Voice is Kokoro, local. Rendering, sound, the
mix, the master and every gate need no model. The one gap is the critic and
the hand-in judge, which need a vision model: with none, those gates are
`pending` with a reason and the video is `ready-for-review`, as `make`
reports today (`criticPending` in `src/make/index.js`).

Nothing new is added for scale. Running many videos, queues across
machines, servers and job APIs are the host application's work.

**What a host relies on, all of it existing unless marked new:**

| Need | How |
|---|---|
| Start a run | `launchclip make "<prompt>" --out <dir> --json`, or `createEngine()` from `@launchclip/engine` with its own adapters (`src/engine/index.js`) |
| Use its own models | the `llm` adapter, or `--model provider:model`; `compatible:` routes reach any OpenAI-compatible endpoint (`src/model_provider.js`) |
| Follow progress | one `launchclip:progress {…}` line per event on stderr (`src/progress.js`) |
| Read the result | `MAKE.json`: status, stages, gates, costs, next steps (`src/make/index.js`) |
| Hand art in | `HANDIN.json` and files, or the asset-provider hook (§5.3) (new) |
| Know what was used | `qa/hand-in.json` (new) |
| Resume | run the same command again; every stage reuses what has not changed |
| Run in a container | CPU only, no GPU, no network needed for rendering; cgroup CPU and memory limits are respected (`src/capacity.js`); `npm run smoke:container` proves it ([CONTAINER_SMOKE.md](CONTAINER_SMOKE.md)) |

**Exit codes.** Today `make` exits 1 only when a stage fails; `needs-repair`
and `ready-for-review` exit 0 and the host must read `MAKE.json`
(`src/cli.js`). **The animation path returns distinct codes by default:** 0
`ready`, 1 `failed`, 2 `needs-repair`, 3 `awaiting-approval`, 4
`ready-for-review`. Other kinds of video keep today's codes, so no existing
caller breaks. `handin check` and `script check` exit 0 when clean and 1
when anything fails.

## 8. Gates and measurement

### 8.1 Gates that already cover character stories

These run in `finish` today (`src/finish.js`):

| Gate | Checks | Source |
|---|---|---|
| `cast` | the cast is valid; each character is identical in every scene; limbs stay in the safe zone; characters keep their sides; voices are known | `castGate` in `src/cast.js` |
| `acting` | each named action is performed inside its line; nobody faces away from a target | `src/direction_guardrails.js` |
| `physics`, `ghosting`, `density`, `variety` | the world holds still; one copy of a person; no empty frame; no repeated shot | `src/direction_guardrails.js` |
| `holds`, `states` | nothing sits frozen | `src/movement_guardrails.js` |
| `direction`, `coverage` | every line has a decision; the story sits inside its cadence profile | `src/quality_gates.js` |
| `structure` | the skeleton's opening image and key shot | `kit/core/skeleton-library.mjs` |
| `layout`, `motion`, `audio`, `loudness`, `style` | captions read; the picture moves; the mix is clean | `src/finish.js` |

### 8.2 How they extend

**Cadence.** `story-characters` is a seed profile: `"references": 0`, with
ranges set wide on purpose (`kit/profiles/story-characters.json`). It
already holds `character_screen_time`, `expression_changes_per_min` and
`problem_lands_seconds`. Work here:

- measure it from a real reference set with `launchclip profile measure`,
  under the provenance rules of the quality RFC (§5.4);
- add what dialogue needs: speaker turns per minute, seconds per line, the
  share of time on a listener's reaction, and the longest stretch on one
  framing;
- a 9:16 Shorts variant, since character Shorts cut faster than a
  three-minute story.

**Layout.** Code-drawn and sprite shots keep the layout check as it is: the
modules know their rectangles. A handed-in whole shot has none, so it is
treated as footage: `finish` already measures caption legibility on the
rendered frames and plates the lines that do not read. Whether the footage
lane's face tracking finds drawn faces is unproven; where it cannot, the
gate is `not-checked` with a reason.

**Critic.** The same rubric and receipts, with the reference sheets beside
the frames, and the `acting`, `character-consistency` and `lip-sync`
categories (§4.7). The animatic gets its own earlier review, limited to
story, staging and acting.

**New gates.**

| Gate | Fails when |
|---|---|
| `script` | a speaker is unknown; a character never speaks or acts; the script is over its length; the problem lands late |
| `bible` | the story's cast differs from the frozen bible; a sheet is missing; the hash is wrong |
| `hand-in` | an asset in use fails validation or the bible check; an asset has no provenance; the video mixes looks without `--look mixed` |
| `lip-sync` | a rig or sprite mouth is open with no speech under it, or closed through a spoken line; `not-checked` for a handed-in whole shot |

Every gate reads only the project and calls no model, except the hand-in
judge. Repairs fix the shot and never the gate.

### 8.3 Measuring parity for animation

The method is MAKE_SKILL_PARITY.md's: a fixed set of briefs through both
paths, compared from the files they leave.

**Briefs.** Six, each a 30–45 second 9:16 Short:

1. two characters, a problem and a fix (a product story);
2. `pov`: one character caught in the viewer's situation;
3. `last-time`: two characters in an ordinary moment;
4. an argument: two characters who disagree, mostly dialogue;
5. a silent story: almost no dialogue, all acting;
6. three characters, one of whom barely speaks.

**Metrics, per video:**

- contracts: each file in §4 validates, and how many repair passes it took;
- story: lines per character, the share of silent lines, when the problem
  lands;
- design: distinct characters, and whether each role's `must_keep` list
  differs from the others';
- direction: actions per minute, distinct poses and expressions used, the
  share of lines played on a reaction, framings used;
- cadence: every measure in the profile;
- gates: which passed on the first render;
- critic: the verdict, blocking findings, and retake rounds used;
- cost and wall-clock time.

**Parity** means every numeric metric from `make` is within 15% of the
skill's on the same brief (the bar MAKE_SKILL_PARITY.md sets), the same
gates pass, and the critic's verdict is no worse.

**Two tests keep it honest between eval runs:**

- A contract test, modelled on `test/direction_paths.test.js` and
  `test/subject_paths.test.js`: one fixture goes through headless planning
  with recorded model responses and through the skill's documented steps,
  and both must produce a valid script, a frozen bible and a direction map
  that use the same vocabulary.
- The format scorecard (`npm run eval:formats`, `eval/formats.mjs`) gains
  the animation briefs.

Hand-in is the same on both routes by construction: one check, one report.
Its own test set is fixtures of good and deliberately wrong art (§9, phase
9).

## 9. Delivery plan

Small PRs, each green on its own, stacked in order. Phases 1–8 are the
vertical slice: **one prompt to a 30-second Short with two characters,
drawn in code, with the critic loop.** Phases 9–12 are hand-in. Phases
13–14 are series bibles and longer forms.

### The vertical slice

**Phase 1. The script contract.**
- Scope: `SCRIPT.json` v2 with speakers and silent lines, a reader that
  takes v1 as all-narrator, validation, the conversion to
  `audio.narration.lines`, `launchclip script check <project>`.
- Files: `kit/core/screenplay.mjs` (new), `src/make/script.js`
  (`SCRIPT_VERSION`), `src/script_check.js`, `src/script_check_cli.js`,
  `src/cli_usage.js`, `test/screenplay.test.js`, `docs/KIT_CONTRACTS.md`.
- Done when: a hand-written two-character script validates; each rule in
  §4.1 has a failing fixture; a v1 script still reads; `launchclip voice`
  voices the derived lines in three voices with a speaker on every word.

**Phase 2. The show bible.**
- Scope: the schema, validation, `launchclip bible freeze | show`, a sheet
  per character, `must_keep` derived from rig parameters, the `bible` key on
  the story and the direction map, the `bible` gate.
- Files: `kit/core/bible.mjs` (new), `src/bible.js` (new),
  `src/cast_design.js` (the sheet), `src/character_store.js`,
  `kit/core/story.mjs` (`TOP_LEVEL`, `STORY_REVISION`),
  `kit/core/direction.mjs`, `src/finish.js`, `test/bible.test.js`.
- Done when: freezing a bible from two saved characters writes sheets and a
  hash; a story whose cast differs from its bible fails the gate; a story
  with no bible still validates.

**Phase 3. Shot fields.**
- Scope: `line` on map lines, the "speaker is on screen" rule, `launchclip
  story shots [--json]`.
- Files: `kit/core/direction.mjs`, `src/story_cli.js`,
  `test/direction.test.js`, `examples/story/` (a two-character dialogue
  example).
- Done when: the example validates and renders in both renderers within
  parity; `story shots` lists its shots with frames, poses and lines; a line
  spoken off screen with no `why` fails.

**Phase 4. The model check and vision for Anthropic.**
- Scope: `doctor --models`, `model_access` in `MAKE.json`, image input on
  the Anthropic client.
- Files: `src/doctor.js`, `src/make/models.js`,
  `src/storyboard_planner.js` (`AnthropicPlannerClient`), `src/make/index.js`
  (`stageModel`), `test/model_access.test.js`.
- Done when: the check is right for each combination of keys in the tests
  and makes no paid call; with only an Anthropic key, `make --critic`
  writes `qa/critic.json`.
- Independent of phases 1–3; it also helps every other kind of video.

**Phase 5. Writers' room in `make`.**
- Scope: `format: "animation"` in routing, `--animation`, and the three
  writing calls with one repair pass. Stops after the script and voice.
- Files: `src/make/routing.js`, `src/make/options.js`,
  `src/make/animation.js` (new), `src/make/index.js` (`stagePrepare`),
  `test/make_animation.test.js`.
- Done when: with recorded model responses, `make "<prompt>" --animation`
  writes a valid `SCRIPT.json` and a `NARRATION.json` with a narrator and
  two characters, and a rerun reuses both.

**Phase 6. Bible and planning in `make`.**
- Scope: `stageBible` (the model designs the cast through the `cast create`
  set paths and picks the world), then the existing direction and
  storyboard planning with the bible pinned and the script in the brief;
  `--stop-after bible` and `--approve`.
- Files: `src/make/index.js`, `src/make/animation.js`,
  `src/storyboard_planner.js` (the brief, the pinned cast), `src/cast_fit.js`
  (never rename a bible's cast), `src/make/options.js`.
- Done when: the fixture plans a storyboard that passes `story validate`,
  the `cast` gate and the `bible` gate; a replan cannot change who is in
  the story; a headless run with `--stop-after bible` ends
  `awaiting-approval` and resumes with `--approve bible`.

**Phase 7. The animatic and the critic loop.**
- Scope: `finish --animatic`, `ANIMATIC.json`, the staging review, the
  sheets in the critic's evidence, the new finding categories,
  `qa/retakes.json`, retake steps 1 and 3 of §4.7, `--stop-after animatic`,
  the animation path's exit codes (§7).
- Files: `src/finish.js`, `src/make/index.js` (`stageAnimatic`,
  `criticRepairs`), `src/make/critic.js`, `src/make/critic_repair.js`,
  `src/cli.js`, `skills-src/references/cinematic-production.md`,
  `test/make_critic_repairs.test.js`.
- Done when: one prompt produces a 30-second Short with two characters and
  dialogue; the report is `ready` on a `ship` verdict or `needs-repair`
  after three rounds; a seeded bad shot is fixed by a retake that re-renders
  only that shot.
- **This is the end-to-end slice.**

**Phase 8. The skill path, measurement and mouths.** Three PRs.
- *Skill:* an animation branch in the quick path, a generated
  `references/animation.md` (the script, the bible, the shot list, the two
  approval points), and the parity contract test. Files: `skills-src/`,
  `scripts/sync-skills.mjs`, both create-video skills (generated),
  `test/animation_paths.test.js`. Done when `npm run skills:check` is green
  and an agent given only the skill and a new brief produces the same
  contracts and a finished Short.
- *Measurement:* the six briefs in the scorecard; the `story-characters`
  profile measured from references, with the dialogue measures; the
  `script` gate. Files: `eval/formats.mjs`, `eval/formats.json`,
  `eval/fixtures/`, `kit/profiles/story-characters.json`,
  `kit/profiles/PROVENANCE.md`, `kit/core/cadence.mjs`. Done when both
  paths run the six briefs and the parity table is in `benchmarks/`.
- *Mouths:* phonemes kept in `NARRATION.json`, mouth shapes on the rig, the
  `lip-sync` gate. Files: `src/voice/kokoro.js`, `src/voice/dialogue.js`,
  `kit/core/characters/acting.mjs`, `src/quality_gates.js`. Done when a rig
  character's mouth shapes follow its phonemes in both renderers within
  parity. This touches the acting code, so it is agreed with the acting
  work first.

### Hand-in

**Phase 9. The hand-in contract and check.**
- Scope: `HANDIN.json`, validation for all three kinds, the measured bible
  check, the vision judge, `qa/hand-in.json`, the `hand-in` gate,
  `launchclip handin check`. No rendering change yet.
- Files: `kit/core/hand-in.mjs` (new), `src/hand_in.js` (new),
  `src/sprite_cast.js` (its sprite-folder checks, shared), `src/make/critic.js`
  (the judge), `src/cli.js`, `test/hand_in.test.js`,
  `test/fixtures/hand-in/`.
- Done when: fixtures with a missing pose, mismatched sprite sizes, an
  opaque background, a short clip, a wrong outfit, a wrong skin tone, a
  dropped headscarf and an extra person are each rejected with a reason
  that names the fix; good art passes; with no vision model the judge is
  `not-checked`.

**Phase 10. `cast sprites` without built-in generation.**
- Scope: remove the built-in image adapter and its key and model settings.
  `launchclip cast sprites` and `makeSpriteCast` draw only through an image
  adapter the host passes in (`generate({prompt, references, size})`, the
  shape it takes today). With none, the command lists the pictures a cast
  needs (`--dry-run` does this now) and checks sprites already in the
  folder with phase 9's checks. Nothing in LaunchClip calls an image
  service after this.
- Files: `src/sprite_cast.js` (`openaiImageAdapter`, `SPRITE_IMAGE_USD`,
  `LAUNCHCLIP_SPRITE_MODEL`), `src/cast.js`, `src/engine/adapters.js` (an
  `image` adapter key), `src/cli_usage.js`, `packages/engine/README.md`,
  `docs/KIT_CONTRACTS.md` ("Sprite casts"), the sprite-cast tests.
- Done when: no file under `src/` calls an image API; with a stub adapter
  the command writes the same folder layout as before; with no adapter it
  exits 0 after listing and checking, and says how to hand sprites in.
- A breaking change for anyone who used the built-in adapter; the release
  notes say so.

**Phase 11. Plates and sprite casts in the render.**
- Scope: a prototype first (one cast scene on a handed-in plate, and its
  sprite form, reviewed before the rest is built); then the plate under a
  cast scene with `floor` and `light`; the compile from a cast scene to its
  `sprite-scene` form; the one-look rule; fallback.
- Files: `kit/core/catalog-characters.mjs`, `kit/core/catalog-sprites.mjs`,
  `kit/core/story.mjs` (the resolved copy), `src/finish.js`,
  `src/render_segments.js`, `test/fixtures/parity/characters-plate-*.json`,
  `test/fixtures/parity/sprite-form-*.json`.
- Done when: the phase 7 Short renders with a handed-in plate and with a
  handed-in sprite cast, in both renderers within parity; removing one
  character's sprites drops the whole video to code-drawn and the report
  says why; replacing one sprite re-renders only that character's scenes.

**Phase 12. Whole shots, the hook, and driving from a host.**
- Scope: a handed-in clip in a shot's window under code-drawn captions and
  cards; character shots and plates asked for through the asset-provider
  hook; the footage checks on handed-in shots; retake step 2; a container
  smoke run of the animation path with hand-in.
- Files: `src/asset_provider.js`, `src/asset_provider_cmd.js`,
  `src/finish.js`, `src/make/critic_repair.js`, `src/engine/adapters.js`,
  `packages/engine/README.md`, `scripts/container-smoke/`,
  `docs/CONTAINER_SMOKE.md`.
- Done when: a stub provider command that answers some shots and returns
  `null` for others gives a code-drawn video under the one-look rule and a
  fully handed-in video when it answers all; the container smoke passes
  with no network; each exit code of §7 is covered by a test.

### Series and longer forms

**Phase 13. Series bibles.**
- Scope: a bible that lives in a collection (`src/collection.js`), so every
  episode shares its cast, voices, world and style; an episode's bible
  extends it with guests; the bible's hash in the video's provenance, so a
  changed series bible marks its episodes stale as a changed style does
  today.
- Files: `src/collection.js`, `src/collection_cli.js`, `src/bible.js`,
  `kit/core/bible.mjs`, `docs/COLLECTIONS_RFC.md`.
- Done when: two episodes made from one collection have identical
  characters and voices; adding a guest to one episode does not change the
  other.

**Phase 14. Longer forms.**
- Scope: animation past three minutes on the long-form plan: a script in
  chapters, a voice per chapter, a shot list per chapter, a render that
  resumes by chapter (LONG_FORM_MAKE_RFC.md), and Shorts cut from it.
- Files: `src/make/long_form.js`, `src/make/animation.js`,
  `kit/core/long-form.mjs`, `kit/core/beat-director.mjs`.
- Done when: a five-minute animated story with three characters renders by
  chapter, a failed chapter resumes alone, and a Short cut from it passes
  the Shorts profile.
- Its own RFC first, once the parity runs show Shorts are good.

### Dependencies

- Phases 1, 2, 3 and 4 can run side by side.
- Phase 5 needs 1. Phase 6 needs 2, 3 and 5. Phase 7 needs 6 and 4.
- Phase 8's three PRs need 7 and can run side by side.
- Phase 9 needs 2 and 4 and can start before 7. Phase 10 needs 9.
  Phase 11 needs 9 and 7. Phase 12 needs 11.
- Phase 13 needs 2. Phase 14 needs 8.

## 10. Risks

| Risk | What this RFC does about it |
|---|---|
| Code-drawn characters are not engaging enough on their own | The slice measures it first, with a critic and six briefs; acting, styles and families are improving in parallel work; hand-in is there for those who want another look |
| Small local models write weak scripts | Each writing step is small and validated; the skeleton carries structure; the parity run measures it per model tier |
| Handed-in art does not match the characters | Validation, the bible check, one look per video, and a code-drawn fallback that is already rendered |
| Art that erases a headscarf or changes a skin tone | `must_keep` is a hard rejection with no override |
| Contracts multiply and drift apart | One new story file (the bible), one hand-in file, and additive fields elsewhere; one validator each; skills generated from the same registry |
| Parallel work changes the cast, acting and style code underneath | The bible names characters, styles and sets by id and never defines their shape |

## 11. Decisions

Settled by the owner on 2026-11-10. The body of this RFC is written to them.

1. **Script file.** `SCRIPT.json` grows speakers and silent lines. No new
   file (§4.1).
2. **Looks.** One look per video. `--look mixed` is the exception (§5.5).
3. **Review stops.** Attended runs stop for approval after the bible and
   after the animatic. Headless runs continue unless `--stop-after` is
   given (§6.3).
4. **Lip sync.** Mouth shapes from phonemes on the rig are the bar for the
   first release (§4.6).
5. **A critic with only an Anthropic key.** The existing Anthropic adapter
   gains vision (§6.2, phase 4).
6. **The sprite form** stays its own form, and is the hand-in path for
   character art (§5.2).
7. **Narrator.** Character Shorts default to a narrator with dialogue
   (§4.1).
8. **Series.** A bible can live in a collection, shared by its episodes
   (phase 13).
9. **Reference images** map to traits, never to a real person's likeness
   (§4.2).
10. **`launchclip cast sprites`** takes an image adapter supplied by the
    host and has no built-in generation. The code change is phase 10; this
    RFC changes no code.
11. **Exit codes.** The animation path returns distinct exit codes by
    default (§7).
12. **A hand-in with no vision model** is used, with the judge marked
    `not-checked` (§5.4).
13. **Stories with child characters** have no extra limits for now, beyond
    the evidence and honesty rules every story follows.

## 12. Non-goals

- **Generating images or video**, in LaunchClip or through a service it
  calls. That includes model providers for pictures, control passes for
  steering a model, generation budgets, and training or fine-tuning.
- **Hosting.** No server, remote worker, job API or queue across machines.
  A host application owns those.
- **Naming or depending on any host application.**
- **A timeline or shot editor.** Editing stays in chat, the storyboard and
  the NLE exports.
- **Anyone's likeness.**
- **Replacing the renderers or the storyboard contract.** Every addition is
  a field, a file or a gate.
- **Changing the skill for other kinds of video.** The animation branch is
  additive.
- **The character kit itself.** New character families, livelier acting,
  drawing styles and style analysis from references are separate work.
  This RFC uses them.
