# RFC: Animation from one prompt

Status: draft, open for review
Date: 2026-11-10
Builds on: [VIDEO_QUALITY_RFC.md](VIDEO_QUALITY_RFC.md) (§6.3 narrative maps, §10.5 character narratives),
[STORYBOARD_ENGINE_RFC.md](STORYBOARD_ENGINE_RFC.md) (the storyboard contract),
[MAKE_SKILL_PARITY.md](MAKE_SKILL_PARITY.md) (one quality bar for both paths),
[LONG_FORM_MAKE_RFC.md](LONG_FORM_MAKE_RFC.md) (resumable stages),
[DUAL_RENDERER_PLAN.md](DUAL_RENDERER_PLAN.md) (two renderers, one contract),
[COLLECTIONS_RFC.md](COLLECTIONS_RFC.md) (§5 capacity and the machine queue),
[KIT_CONTRACTS.md](KIT_CONTRACTS.md) ("Character modules")

## 1. Summary

The goal is a character animation people want to watch, made from one prompt:
a 30–60 second Short first, full animations later. It must work two ways: led
by an agent on the user's own AI subscription (the create-video skill), and
fully built in (`launchclip make`). It must run on one Mac, and use a bigger
machine or a hosted model only when the Mac cannot do the work.

Most of the parts exist. What is missing is the pipeline that joins them.

What exists today:

- A code-drawn character kit: one rig, 30 starter characters, generated
  casts, ten drawing styles, named poses, expressions and acting cues,
  thirteen sets, and two modules, `cast-scene` and `character-cameo`
  (`kit/core/characters/`, `kit/core/catalog-characters.mjs`).
- Illustrated characters: `sprite-scene` plays pose sprites drawn once by an
  image model (`kit/core/catalog-sprites.mjs`, `src/sprite_cast.js`).
- Narrative direction maps: story beats, cast cues and a key action per line
  (`kit/core/direction.mjs`).
- Dialogue in several voices, with every word tagged with its speaker
  (`src/voice/dialogue.js`).
- Gates for character stories: cast, physics, acting, ghosting, density,
  variety, holds and states (`src/cast.js`, `src/direction_guardrails.js`,
  `src/movement_guardrails.js`, all run by `src/finish.js`).
- A critic that sends its findings back to the planner and re-renders only
  the scenes that changed (`src/make/critic_repair.js`).
- A machine queue with slots sized to the hardware (`src/queue.js`,
  `src/capacity.js`).

What is missing:

- **`make` cannot write a story with dialogue.** Its script pass writes one
  narration and forbids speaker labels (the prompt in `src/make/script.js`).
- **Nothing freezes the cast, world and style before shots are planned.** The
  planner binds a cast while it plans (`src/cast_fit.js`), so a replan can
  change who is in the story.
- **There is one way to draw a shot.** No interface lets an image or video
  model draw it, and nothing reports which models this machine or account can
  reach.
- **Nothing checks a generated character against its design.** The cast gate
  checks rig parameters, which only works for shots the rig drew.

This RFC adds one pipeline with fixed file contracts, three render lanes
behind one provider interface, a capability check, and a delivery plan that
starts with a vertical slice on the code-drawn lane.

**Two things are unproven and this RFC does not claim them:** a generated
character that stays the same person from shot to shot, and lip sync on
generated shots. The plan is ordered so the first slice needs neither, and a
measured spike (phase 9) comes before any generative code is built.

## 2. Goals and non-goals

Goals:

- One prompt to a finished 30-second Short with two characters who talk, on
  the code-drawn lane, with the critic loop. No key beyond a language model.
- One set of contracts for both routes. The routes differ only in who plays
  each role.
- A shot can be drawn by the rig, by a model guided by the rig, or by a model
  alone, behind one interface. The story file does not change with the lane.
- The pipeline never fails because a lane is missing. It falls back, and the
  report says which lane drew each shot and why.
- Every stage resumes. A failed or rejected shot costs one shot.
- Cost and time are estimated before spending and capped while spending.

Non-goals are in §12.

## 3. The pipeline at a glance

| # | Stage | Writes | Model work | Exists today |
|---|---|---|---|---|
| 1 | Writers' room | `SCREENPLAY.json` | premise, loglines, screenplay | no (narration only) |
| 2 | Show bible | `BIBLE.json`, `bible/sheets/` | cast and world choices | parts: `story.cast`, `cast sheet` |
| 3 | Voice | `NARRATION.json` | none (local voices) | yes |
| 4 | Shot list | `DIRECTION.json`, `storyboard.json` | direction map, then storyboard | yes, extended here |
| 5 | Animatic | `renders/animatic.mp4`, `ANIMATIC.json` | none | yes (it is a draft `finish`) |
| 6 | Shot production | `shots/<id>/SHOT.json`, a clip per shot | image or video models | no |
| 7 | Sound and conform | `AUDIO-MANIFEST.json`, `renders/draft.mp4` | none by default | yes |
| 8 | Critic and retakes | `qa/critic.json`, `qa/retakes.json` | a vision model | yes, extended here |

Three rules hold the pipeline together:

1. **The bible is frozen before the shot list.** Later stages read it and
   never write it. A change to the bible is a new bible, and every shot made
   from the old one is stale.
2. **The animatic locks the timing.** Every shot is first drawn by the rig,
   at its real length, against the real voice. A lane may change how a shot
   looks. It may not change how long it runs.
3. **The storyboard always describes the rig's version of every shot.** So
   the fallback is always renderable, and the code-drawn lane is never a
   special case.

Voice comes before the shot list, as it does today, because scenes and cues
are anchored to measured words (`word:<text>` anchors, resolved in
`kit/core/story.mjs`).

## 4. Stage contracts

Each contract is a versioned JSON file in the project folder. Each has one
writer and one validator, and each records the hash of what it was made from,
so a rerun reuses it while its inputs are unchanged. This is how `make`
resumes today (the header of `src/make/index.js`).

### 4.1 Story and script: `SCREENPLAY.json`

```json
{
  "schema": "launchclip.screenplay.v1",
  "logline": "Maya's deploy fails again; Sam shows her the one check she skipped.",
  "premise": { "want": "ship before lunch", "obstacle": "the same failing deploy", "change": "she checks first" },
  "characters": [
    { "id": "maya", "role": "lead", "want": "to ship", "speech": "short, dry" },
    { "id": "sam", "role": "foil", "want": "to help without gloating", "speech": "warm, unhurried" }
  ],
  "beats": [
    { "beat": "setup", "place": "desk-laptop",
      "lines": [
        { "id": "l1", "speaker": "maya", "text": "Third time today.", "playing": "flat, to herself" },
        { "id": "l2", "speaker": "sam", "text": "Did you run the check?", "playing": "gentle" },
        { "id": "l3", "speaker": null, "action": "Maya turns to look at him.", "seconds": 1.2 }
      ] }
  ],
  "titles": ["She skipped one check"],
  "inputs": { "prompt_hash": "…", "skeleton": "pov" }
}
```

- `beats[].beat` is one of the narrative beats the direction map already
  uses: `setup`, `problem`, `attempt`, `turn`, `resolution`, `cta`
  (`NARRATIVE_BEATS` in `kit/core/direction.mjs`).
- A line is spoken (`speaker` is a character id or `"narrator"`) or silent
  (`speaker: null` with an `action` and a length). Silent lines are where
  acting happens, and a narration has no place for them.
- `playing` is a note for the acting and the voice. It is never spoken.
- `characters` here are roles, wants and ways of speaking. How a character
  looks belongs to the bible.

**Writer.** The writers' room. Three steps, each small: a premise from the
prompt; three to five loglines judged in a fresh context, as the skill
judges concepts today (step 2 of `skills/launchclip-create-video/SKILL.md`);
then the screenplay on a skeleton. Two library skeletons are already
character stories, `last-time` and `pov` (`kit/core/skeleton-library.mjs`).

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
      { "id": "maya", "from": "maya", "voice": "af_heart", "position": "left",
        "character_file": "cast/maya.character.json",
        "sheet": "bible/sheets/maya.png", "fingerprint": "…",
        "identity": { "must_keep": ["curly dark hair", "teal hoodie", "round glasses"] } }
    ]
  },
  "world": { "kind": "office", "time": "day", "sets": ["desk-laptop", "standing"] },
  "style": { "pack": "styles/project.json", "seed": 4821, "drawing_style": "outlined",
             "references": ["bible/style/frame-1.png"] },
  "rules": ["Sam never raises his voice."],
  "inputs": { "screenplay_hash": "…" }
}
```

- `cast` is exactly the `story.cast` shape ("Story cast" in
  KIT_CONTRACTS.md), with four additions per character: the saved character
  file it came from, its reference sheet, its fingerprint, and `must_keep`.
- `must_keep` is the short list of features a viewer would notice changing.
  Tooling writes it from the rig parameters (hair, skin tone, outfit,
  glasses, headwear, mobility aid). The identity check reads it (§5.4).
- `world` names a world and the sets the story may use
  (`kit/core/catalog-world.mjs`, `kit/core/characters/sets.mjs`).
- `style` points at the project's style pack and seed
  ([SEEDED_STYLES_RFC.md](SEEDED_STYLES_RFC.md)), plus still frames that show
  the look, for lanes that need a picture of it.

**Reference sheets.** One PNG per character: a turnaround, every pose and
expression the screenplay could call for, and a face close-up. It is drawn
with the modules' own view tree, as `launchclip cast sheet` draws the story
sheet today (`castSheet` in `src/cast.js`). So the sheet is the character,
not a description of it. For an illustrated character the sheet is its
anchor sprite and poses (`src/sprite_cast.js`).

**Writer.** The bible stage. It picks or builds each character from the
screenplay's roles: a saved character file, a starter, or a generated cast
(`generateCast` in `kit/core/characters/generate.mjs`). It gives each
speaking character a different voice, picks the world and sets, and renders
the sheets.

**Validator.** A new `kit/core/bible.mjs`:

- `storyCastErrors` and `resolveStoryCast` pass (`kit/core/characters/cues.mjs`);
- every screenplay character has an entry, a voice and a sheet on disk;
- every set and world exists;
- the hash matches the content.

**Frozen means pinned.** Once frozen, `story.cast` is copied from the bible
and reset if a model changes it. The planner already pins a bound cast this
way (`fixed.cast` in `src/storyboard_planner.js`). A new `bible` gate in
`finish` fails when `story.cast` and the bible disagree.

**Inputs from parallel work.** The saved character file (`cast create`,
`cast edit`) and the drawing-style traits read from references are being
built in other sessions. The bible points at their files by path and hash.
It does not define their shape.

### 4.3 The shot list: `DIRECTION.json` and `storyboard.json`

There is no new shot-list file. **A shot is a track-0 character scene in
`storyboard.json`**, and the direction map says why it exists. Both files
grow by small, additive fields.

`DIRECTION.json` (`launchclip.direction-map.v1`):

- `bible: {file, hash}` at the top level. `validateDirection` rejects
  unknown top-level fields today (`kit/core/direction.mjs`), so this is a
  small code change.
- A line may carry `line: "l2"`, the screenplay line it plays. The word range
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
- A character scene may carry a `production` block:

```json
{ "id": "s3", "module": "cast-scene", "start": "word:check", "end": "word:oh#1",
  "params": { "set": "desk-laptop", "shot": "medium", "cast": [ … ] },
  "production": {
    "lane": "guided",
    "describe": "Maya slumps at her desk; Sam leans in from the right, patient.",
    "continuity": { "after": "s2" },
    "allow_fallback": true
  } }
```

`lane` is `rig`, `guided` or `generative`; without a block a scene is `rig`.
`describe` is one sentence a person or a model can draw from. The word
`shot` already means framing (`params.shot`: wide, medium or close) and a
media request (`{kind: "shot"}` in `src/asset_provider.js`), so the block is
called `production`.

**Writer.** The planner or the agent, in the order both paths already use:
the direction map first, then the storyboard against it (quality RFC §6.4).

**Validator.** `launchclip story validate`: the checks it runs today, the
bible reference, and the `production` block's shape. A new `launchclip story
shots <project>` prints the shot list (id, time, who, set, framing, lane,
the line it plays) for a person or an agent to review. It is a view of the
two files, and nothing reads it back.

### 4.4 The animatic: `ANIMATIC.json`

The animatic is the whole story drawn by the rig at draft quality, with the
real voice and captions. It is `launchclip finish` with every shot on the
`rig` lane, written to `renders/animatic.mp4`.

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
pass on the animatic before a single generative call is paid for. The critic
reviews the animatic for story, staging and acting only, which are cheap to
fix here and costly later.

On the code-drawn lane the animatic, rendered at delivery quality, is the
video. Stage 6 does nothing.

### 4.5 Shot production: `shots/<id>/SHOT.json`

```json
{
  "schema": "launchclip.shot.v1",
  "shot": "s3", "lane_asked": "guided", "lane_used": "guided",
  "provider": { "name": "comfy-local", "model": "…", "version": "…", "placement": "local" },
  "inputs": { "hash": "…", "seed": 71, "prompt": "…",
              "control": { "pose": "…", "line": "…", "matte": "…", "depth": "…" },
              "sheets": ["bible/sheets/maya.png", "bible/sheets/sam.png"] },
  "output": { "clip": "assets/shots/s3.mp4", "frames": 111, "fps": 30, "width": 1080, "height": 1920 },
  "identity": { "status": "passed", "checks": { "palette": 0.94, "silhouette": 0.88, "judge": "same" } },
  "attempts": [ { "seed": 70, "result": "identity-failed", "seconds": 212, "usd": 0 } ],
  "cost_usd": 0, "seconds": 431,
  "fallback": null
}
```

**Writer.** The shot stage, once per shot. **Validator.** A new `conform`
gate (the clip has exactly the animatic's frame count, rate and size) and
the `identity` gate (§5.4). A rig shot writes a short record too, with
`lane_used: "rig"` and no provider, so the report can list every shot the
same way.

The clip lands in `assets/shots/`, the folder the asset-provider hook
already uses (`SHOTS_DIR` in `src/asset_provider.js`). The user's
`storyboard.json` is not rewritten. `finish` never rewrites it today; it
renders a resolved copy (`src/finish.js`). In that copy, a shot with a
passing record plays its clip in the scene's window. Captions, cards, the
brand frame and any real screen capture are still drawn in code on top.

### 4.6 Sound

No new contract. The existing ones cover it:

- `NARRATION.json`: words, each with its speaker, plus lines and gaps
  (`src/voice/dialogue.js`).
- The sound score planned from what the storyboard does and says
  (`src/sfx/score.js`), the music choice (`src/music/index.js`), the mix and
  the −14 LUFS master, recorded in `AUDIO-MANIFEST.json` (`src/finish.js`).

Two additions:

- **Mouth shapes.** The rig opens and closes mouths on word timings
  (`kit/core/characters/acting.mjs`). Kokoro already reports a duration for
  every phoneme, which `src/voice/kokoro.js` folds into word times. Keeping
  those phonemes in `NARRATION.json` would give the rig real mouth shapes at
  no cost. This is the cheapest lip sync available, and it is in the first
  slice's follow-ups (phase 8).
- **Sound follows retakes.** The score is planned from the storyboard, so a
  retake that changes a scene's cues re-plans that scene's sounds. A retake
  that only regenerates pixels changes no sound.

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
findings, the shots they name, what was tried, what it cost, and whether the
round was kept. **A retake fixes the smallest failing shot**, by the
cheapest step that could work:

| Step | What changes | Costs | Applies to |
|---|---|---|---|
| 1. Regenerate | a new seed, same inputs | one generation | guided, generative |
| 2. Redirect | that scene's cues, framing or `describe` | a planner repair and one shot | all lanes |
| 3. Drop a lane | that shot falls back (§6.3) | one render | guided, generative |
| 4. Replan the beat | the scenes of one story beat | a planner call and its shots | all lanes |

A round that does not lower the blocking and major findings is undone, as
today (`criticImproved`, `snapshotRound` and `restoreRound` in
`src/make/index.js`). The limit stays three rounds (`MAX_CRITIC_REPAIRS`;
"at most three passes" in the skill). After three, the result is
`needs-repair`, and it is reported, not delivered as finished.

## 5. Render lanes and the provider interface

### 5.1 The lanes

| Lane | Draws the shot | Needs | Identity | Timing |
|---|---|---|---|---|
| `rig` | the code-drawn kit, in either renderer | nothing beyond today's install | exact, by construction | exact |
| `guided` | an image or video model, steered by the rig's control passes and the character sheets | an image or video model, local or hosted | checked (§5.4) | exact: the rig's frames set it |
| `generative` | a video model, from the sheets and the shot's description | a video model | checked (§5.4) | fitted: trimmed or retimed to the shot |

`sprite-scene` is a form of the `rig` lane, not a fourth lane: an image
model draws the art once, and code animates it. It needs only an image
model, and it already shows one way to keep a generated character
consistent: every picture is an edit of one anchor picture
(`src/sprite_cast.js`). It is the cheapest step up from code-drawn art, and
the capability check reports it separately (§6.2).

Inputs and outputs per lane:

| | `rig` | `guided` | `generative` |
|---|---|---|---|
| In | the resolved scene, the bible | the control passes (§5.3), the rig's own render of the shot, the sheets, the style frames, `describe`, a seed | the sheets, the style frames, `describe`, the previous shot's last frame (optional), a seed |
| Out | a render segment (`src/render_segments.js`) | a clip with the animatic's exact frame count | a clip of about the shot's length, conformed by tooling |
| Still drawn in code | everything | captions, cards, brand frame, real screen captures | captions, cards, brand frame |
| Acting | the cues, exactly | the cues, as far as the model follows the pose pass | whatever the model does with `describe` |

Two rules for the generative lanes:

- **A real capture is never regenerated.** A set's screen plays the user's
  own capture and never an invented UI (`kit/core/characters/sets.mjs`). In
  a guided shot the screen area is masked out and the real capture is
  composited back.
- **Text is never generated.** Captions and on-screen words stay in code,
  where the layout and contrast checks can measure them.

### 5.2 The provider interface

What exists to extend:

- **Engine adapters.** Every model and provider call goes through a named
  adapter: `llm`, `tts`, `music`, `transcribe`, `matting`, `assets`,
  `renderer`, `notice` (`ADAPTER_KEYS` in `src/engine/adapters.js`).
- **The asset-provider hook.** `findShot(request) → shot | null`; a missing
  shot becomes a repair note, never a failure (`src/asset_provider.js`). An
  app can also supply it as its own command, speaking one JSON line per
  request (`--asset-provider-cmd`, `src/asset_provider_cmd.js`).
- **The image adapter for sprites.** `generate({prompt, references, size})
  → {buffer} | {file}` (`openaiImageAdapter` in `src/sprite_cast.js`).
- **Voice and music registries**, each with a deterministic or local default
  and a paid upgrade (`src/voice/index.js`, `src/music/index.js`).

The new adapter, `shots`, follows the same pattern:

```
provider: {
  name,
  lanes: ["guided"] | ["generative"] | both,
  placement: "local" | "remote" | "hosted",
  capabilities() → { available, reason?, models: [...], max_seconds, sizes, control: ["pose","line","matte","depth"], paid }
  estimate(request) → { usd, seconds }
  submit(request, { outDir, signal }) → { job_id }
  poll(job_id) → { status, progress?, result? }
}
request: { id, shot, lane, describe, seed, fps, frames, width, height,
           control: { pose?, line?, matte?, depth?, reference }   (file paths)
           sheets: [...], style_frames: [...], previous_frame?,
           must_keep: { <character>: [...] }, brief }
result:  { clip: file, frames, source: { provider, model, version, licence, generated: true }, cost_usd, seconds }
```

- `submit` and `poll` are separate so a job outlives the process. The job id
  is saved before waiting. The language-model clients do the same thing
  (`onSubmitted` and `resumeStructured` in `src/model_provider.js`).
- A provider that cannot do the work returns `available: false` with a
  reason. It never throws for a missing key.
- **A `test` provider is built in**, as the voice registry has one. It
  returns the rig's own render as the "generated" clip, so the whole
  generative path runs offline and in CI with no model.
- **A command provider** (`--shot-provider-cmd`) speaks the same JSON over
  stdin and stdout as the asset provider's. This is how the community plugs
  in any model, and how an agent on the skill path offers an image or video
  tool it has, without that model's code living in this repo.

Selection mirrors the language model's (`selectMakeModel` in
`src/make/models.js`): the `--shot-provider` flag, then
`LAUNCHCLIP_SHOT_PROVIDER`, then the best available provider for the lane
from the capability check. No provider is ever chosen silently if it costs
money (§5.6).

### 5.3 Control passes

The guided lane works only if the rig can describe a shot in the forms
image and video models take as control. The rig can do this because it is a
tree of shapes with stable part ids and joints, and every value is a pure
function of time (`kit/core/characters/view.mjs`; "Part ids" in
KIT_CONTRACTS.md).

| Pass | What it is | How it is made |
|---|---|---|
| `reference` | the rig's own render of the shot, with no captions or cards | the shot's segment, with overlays off |
| `pose` | a skeleton per character per frame, as an image sequence and as keypoints in `pose.json` | the joint pivots of each actor, read from the op list at each frame |
| `line` | clean line art, white on black | the shot drawn in the `line` drawing style (`kit/core/characters/style-line.mjs`), with no plate |
| `matte` | one flat colour per character; also the front furniture, the screen area and the caption band | each actor's shapes filled flat, by character id; rects the layout check already knows |
| `depth` | near-to-far order as a grey image | layer order: the set's back layer, each character by its slot, the front layer (`kit/core/characters/sets.mjs`) |

Notes:

- Passes are extra renders of the same frames with a different pen. They are
  exact and frame-aligned, with no pose estimator or segmenter in the loop.
- **Depth is the weak pass.** The rig is 2D, so its depth is an order of
  layers, not distance. Whether a depth-guided model accepts it is unproven.
  The fallback is to estimate depth from the `reference` pass with a local
  monocular depth model. The spike measures both.
- Passes are written to `shots/<id>/control/<pass>/`, hashed, and cached
  with the shot.
- Remotion renders by frame range and writes PNG stills
  (`src/renderers/remotion_segments.js`), so passes ship on Remotion first.
  HyperFrames' CLI has no frame range (the header of
  `src/render_segments.js`), so on HyperFrames a pass is a whole-video
  render, cached by the timeline's hash.

### 5.4 Checking identity after generation

On the rig lane a character cannot drift: scenes name characters by id and
never carry parameters, and `castConsistency` checks it
(`kit/core/characters/cues.mjs`). A generated shot has no parameters to
compare, so its pixels are checked against the sheet. There are three
layers, cheapest first, and a shot must pass all that can run:

1. **Measured, no model.** Inside each character's matte (known exactly on
   the guided lane), the character's own hair, skin and clothing colours
   are present within a tolerance (`kit/core/oklch.mjs` has the colour
   maths). On the guided lane the generated silhouette must overlap the
   rig's matte. This catches a wrong outfit, a wrong skin tone, a missing
   or extra person, and a pose the model ignored.
2. **Embedding distance (optional, local).** Crops of the character from
   sampled frames are compared with crops from its sheet, using an image
   embedding model run through `onnxruntime-node`, which is already a
   dependency for matting (`src/subject/models.js`). The threshold is set
   from fixtures, not guessed.
3. **A vision judge.** The critic's model is shown the sheet and a strip of
   frames, and answers a structured checklist built from `must_keep`: same
   hair, same skin tone, same glasses, same headwear, same mobility aid,
   same outfit, anyone extra in frame.

A failure is a retake of that shot (a new seed, at most three attempts),
then a fallback (§6.3). The result goes in `SHOT.json` and the `identity`
gate. When no layer can run, the gate is `not-checked` with a reason, never
`passed`. The face gate behaves the same way with no face data (quality RFC
§11.2).

Two honest limits:

- **Passing this check does not prove the character reads as the same
  person to a viewer.** It catches gross failures. The critic's
  `character-consistency` category and the human review remain the real
  test.
- **`must_keep` protects what must not be erased.** The generated casts
  include faith headwear, mobility aids and the whole range of skin tones on
  purpose (`kit/core/characters/generate.mjs`). A model that drops a
  headscarf or lightens a skin tone fails the check. This is a hard rule
  and no retake budget overrides it.

### 5.5 Caching and resume per shot

A shot's hash covers everything that can change its pixels:

- the bible entries of the characters in it, and the style frames;
- the scene's segment hash (`kit/core/render-segments.mjs`), which already
  covers the scene, its window, its assets and the kit's sources;
- the control passes;
- the lane, provider, model, model version and seed;
- `describe` and the prompt built from it.

Clips are cached by that hash under `.launchclip/shots/<provider>/<hash>/`,
as render segments are under `.launchclip/finish/segments/<renderer>/`
(`src/render_segments.js`). Consequences:

- Editing one shot regenerates one shot.
- Editing a caption or a card regenerates nothing, because those are drawn
  in code on top.
- A crash during a hosted job resumes by polling the saved job id. It does
  not pay twice.
- A rerun after a failure starts at the first shot without a passing record.

Writes go to a temporary name, then a rename, the rule the shared caches
already follow (COLLECTIONS_RFC.md §5.4).

### 5.6 Cost and time budgets

- **Estimate first.** The shot stage sums `estimate()` over the shots and
  prints it before any paid call. `--dry-run` stops there. `launchclip cast
  sprites --dry-run` works this way today (`spriteCastCost` in
  `src/sprite_cast.js`).
- **One cap.** Shot costs join the same tracker as model calls, under the
  existing limit: `--max-cost-usd` or `LAUNCHCLIP_MAX_COST_USD`, default $50
  (`src/cost_tracker.js`). A lower cap for shots alone, `--max-shot-usd`,
  defaults to $0: **nothing paid is generated unless the user sets it.**
- **Every paid call is announced**, as `make` announces its model calls.
- **Attempts are capped**: three per shot, then the fallback.
- **Time.** Each provider reports seconds per shot. The stage prints an
  estimate and, when a deadline is set (`--max-shot-minutes`), stops
  starting new generations and sends the remaining shots down a lane.

No figures are given here for the generative lanes, because none have been
measured in this repo. The only measured number is the rig lane's: `finish`
takes 4–5 minutes for 45 seconds on a CPU worker (LONG_FORM_MAKE_RFC.md §1).
Phase 9 measures the rest and records them in `benchmarks/`, and quotes must
come from that file.

### 5.7 Model options (examples only)

These are examples of what could sit behind the interface. None is chosen,
and the field moves faster than this document. The spike picks from
whatever is strongest when it runs.

| Role | Local | Hosted |
|---|---|---|
| Guided video from pose, line and depth | an open video model with control inputs (the Wan family with VACE; AnimateDiff with ControlNet), run through ComfyUI | Runway's reference and performance tools, Kling, Luma |
| Key frames from a rig still and a sheet | an open image-editing model (FLUX Kontext, Qwen-Image-Edit) with a reference adapter | `gpt-image-1` (already used for sprites), Gemini's image model |
| Video from a sheet and a description | Wan, LTX-Video | Veo, Sora, Kling, Runway |
| In-between frames for key-frame shots | RIFE, FILM | n/a |
| Lip sync on a finished clip | MuseTalk, LatentSync, Wav2Lip | Sync, Hedra |
| Depth from a still | Depth Anything | n/a |

Aggregators such as fal and Replicate can front most of the hosted column
with one key. Licences vary by model and by weight file; a model is added
only after its licence is checked, the rule the matting models already
follow (`src/subject/models.js`).

### 5.8 What is unproven

Said plainly, so nobody plans around it:

- **Shot-to-shot consistency.** No test in this repo shows a generated
  character holding its identity across the six to twelve shots of a Short,
  let alone across episodes. Reference images help. Control passes help
  with pose and layout but not with faces. It may need per-character
  fine-tuning, which is a non-goal for now (§12).
- **Lip sync.** The rig flaps mouths on word timings. That is not lip sync
  and the code says so (`kit/core/characters/acting.mjs`). On generated
  shots, mouths either follow the pose pass loosely or need a lip-sync model
  run over the clip, and those models are trained mostly on real faces.
  Whether they work on drawn characters is unknown.
- **Style match.** A generated shot must look like the bible's style frames.
  Nothing measures that today for generated footage. The style gate
  measures palette and layout mix (`src/style_adherence.js`), which is a
  start.
- **Temporal stability**: flicker, hands, and props that change between
  frames.
- **Running any of this on a Mac in acceptable time.**

The plan answers these with a spike before building (phase 9). If the spike
shows the guided lane is not better than the rig lane, the generative
phases stop there and the rig lane keeps improving.

## 6. Two routes, one set of contracts

### 6.1 Who plays each role

| Stage | Skill path: the agent | `make`: the stage and what it calls |
|---|---|---|
| Capability check | runs `launchclip doctor --lanes --json` and tells the user which lanes are live | `stageModel`, then a new `stageCapabilities` (`src/capabilities.js`) |
| Writers' room | writes the premise; judges loglines in a fresh context; writes `SCREENPLAY.json`; runs `launchclip screenplay check` | new `prepareAnimation` in `stagePrepare`: three structured calls and one repair pass, on the client from `createMakeClient` |
| Show bible | picks or creates characters (`launchclip cast create`), writes `BIBLE.json`, runs `launchclip bible freeze`, looks at the sheets | new `stageBible`: one structured call for cast and world choices, then tooling |
| Voice | `launchclip voice <project>` | `synthesizeNarration` through the dialogue module, as today |
| Shot list | writes `DIRECTION.json`, then `storyboard.json`; `launchclip story validate`; `launchclip story shots` | `stageStoryboard`: `planDirection`, then `planStoryboard`, with the bible pinned (`src/storyboard_planner.js`) |
| Animatic | `launchclip finish <project> --animatic`; reviews it | new `stageAnimatic`: `runFinish` at draft quality, then the critic on staging |
| Shot production | `launchclip shots <project> [--scene <id>]`; reviews each record | new `stageShots` (`src/shots/`) |
| Sound and conform | `launchclip finish <project>` | `stageFinish`, unchanged |
| Critic and retakes | a fresh-context critic writes `qa/critic.json`; the agent repairs the smallest shot, three passes at most; `launchclip cinematic-check` | `stageCritic` and `criticRepairs`, with the retake ladder of §4.7 |

Today's `make` stages are `model`, `inventory`, `demo`, `route`, `prepare`,
`storyboard`, `subject`, `finish` and `critic` (`runMake` in
`src/make/index.js`). The animation path adds `capabilities`, `bible`,
`animatic` and `shots`, and skips `demo` and `subject` unless assets call
for them.

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
in the skill column is local tooling with no model call, except shot
production on a paid provider, which needs the user's opt-in like any paid
provider today.

**One source for prompts and vocabulary.** The beat names, intents, poses,
actions and sets both paths may use come from the kit (`NARRATIVE_BEATS`,
`ACTION_VERBS`, `kitCapabilities()`). The skills' references are generated
from the same registry and checked for drift (`npm run skills:check`). The
screenplay and bible references are generated the same way.

### 6.2 The capability check

`launchclip doctor --lanes [--json]` answers: on this machine, with these
keys, what can draw a shot?

```json
{
  "schema": "launchclip.capabilities.v1",
  "language": { "available": true, "source": "OPENAI_API_KEY", "vision": true },
  "image": { "available": true, "providers": ["openai"] },
  "video": { "available": false, "reason": "no video provider is configured and no local runtime was found" },
  "machine": { "cores": 10, "ram_gb": 24, "gpu": { "name": "Apple M-series", "memory": "unified" } },
  "lanes": {
    "rig": { "available": true },
    "sprite": { "available": true, "paid": true },
    "guided": { "available": false, "reason": "needs a video or image provider with control inputs" },
    "generative": { "available": false, "reason": "needs a video provider" }
  },
  "fallback_order": ["rig"]
}
```

It extends what the code already detects:

- **Keys** come from the environment and `.env` files only (`loadCliEnv` in
  `src/env.js`). `doctor` already reports `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY` (`src/doctor.js`). The
  language-model routes also read `OPENROUTER_API_KEY`,
  `OPENAI_COMPATIBLE_API_KEY` with its base URL, and `OLLAMA_BASE_URL`
  (`src/model_provider.js`).
- **Vision** is known per client: `createMakeClient` returns `vision`, and
  it is false for the Anthropic adapter, which sends text only, and for
  Ollama (`src/make/models.js`, `src/model_provider.js`). So with only an
  Anthropic key, `make` has no critic today. That gap matters more for
  animation, and §11 asks what to do about it.
- **Local models** are detected two ways: a local Ollama by its address
  (`OllamaStructuredClient`), and ONNX weights by file and checksum under
  `$LAUNCHCLIP_HOME/models` (`modelStatus` in `src/subject/models.js`).
  A local shot runtime is detected the same two ways: an address that
  answers, or weights on disk.
- **The machine** comes from `measureMachine` and `detectGpu`
  (`src/capacity.js`).
- **Shot providers** are asked directly: each registered provider's
  `capabilities()`.

The check never downloads anything and never makes a paid call. `doctor`
already holds to that for the matting model (`subjectStatus` in
`src/doctor.js`).

**Most subscriptions give a language model and a vision model, and no video
model.** On the skill path the agent is the language and vision model, so
`language` reads `"source": "agent"` when the check is run with `--agent`.
The `rig` lane is then fully available, and the others depend on keys and
local runtimes exactly as in `make`.

`make` writes the result into `MAKE.json` as `lanes`, so an app can show
what a run will use before it starts.

### 6.3 Fallback order

For each shot: the lane asked for, then `guided`, then `rig`. `rig` is
always available.

- A lane that is not available is skipped before any work, with one line
  saying so.
- A shot that fails its attempts falls to the next lane. Its `SHOT.json`
  records `fallback: {from, reason}`.
- **A video is one look by default.** A Short that cuts between generated
  and code-drawn shots looks broken. So the default policy is `uniform`:
  when more than a set share of shots fall back, the whole video drops to
  the lower lane. The animatic already exists, so this costs nothing extra.
  `--lane-policy mixed` allows per-shot fallback for people who want it.
  The share is an open question (§11).
- The pipeline never fails for want of a lane. The beat director holds the
  same line for long form: it is the fallback that keeps a video from
  failing (MAKE_SKILL_PARITY.md).

## 7. Local-first operation

### 7.1 What runs on a Mac

| Work | On a Mac today | Notes |
|---|---|---|
| Planning (screenplay, bible, direction, storyboard) | yes, with Ollama | takes a `local-model` slot (`src/model_provider.js`); quality on small models is the storyboard RFC's "structured tier" question |
| Voice | yes | Kokoro, local, about 1–2× real time on CPU (LONG_FORM_MAKE_RFC.md §5.1) |
| Rig render, control passes | yes | Chromium frames; a `render` slot |
| Sound score, mix, master, gates | yes | no model |
| Critic and identity judge | not yet | the Ollama client sends no images (`OllamaStructuredClient` builds its messages without them); a local vision critic is new work |
| Identity: colour, silhouette, embedding | yes | no model, or a small ONNX model |
| Guided and generative shots | unproven | unified memory helps; time per shot is unmeasured |

So the first slice runs fully locally except the critic. With no vision
model, the critic gate is `pending` with a reason and the video is
`ready-for-review`, exactly as `make` reports today (`criticPending` in
`src/make/index.js`).

### 7.2 Offload by capacity

Each shot job has a placement, chosen in this order:

1. **Local**, when a local provider reports the lane available and its
   estimate fits the deadline.
2. **The user's own remote node**, when one is configured: another machine
   running LaunchClip, usually one with a bigger GPU.
3. **A hosted provider**, when a key is set and the paid cap allows it.
4. **The next lane down** (§6.3).

Sending work off the machine sends the sheets, the control passes and the
shot description with it. Placement 3 is therefore opt-in and announced,
and the report lists what left the machine.

The remote node is the north star's "content node": the same engine, the
same contracts, reached over the network, so a phone or a laptop can point
at either. Its protocol is not designed here (§11). The provider interface
is shaped so a remote node is just another provider with `placement:
"remote"`.

### 7.3 The job queue

Two existing pieces, used as they are:

- **The machine queue** (`src/queue.js`): one per machine, shared by every
  `launchclip` process. A job takes a slot by holding a lock file, and a
  job that cannot get one waits and says so. Slot kinds are `plan`,
  `local-model`, `render` and `io`, sized from cores and RAM
  (`SLOT_KINDS` and `recommendSlots` in `src/capacity.js`).
- **The project job store** (`src/job_store.js`, `launchclip.jobs.v1`):
  jobs with dependencies and the states `pending`, `submitted`, `running`,
  `succeeded`, `failed`, `stale` and `awaiting_approval`, plus a `remote`
  record for work running elsewhere.

What this RFC adds:

- **A `generate` slot kind** for local shot generation. It is sized from
  GPU memory, defaults to 1, and can be overridden like the others
  (`LAUNCHCLIP_SLOTS=generate:2`). Local generation and a local language
  model compete for the same memory, so on a small machine `generate` and
  `local-model` share one slot.
- **One job per shot** in the job store, depending on the bible and the
  animatic. A hosted or remote job is `submitted` with its remote id, so a
  restart polls it. A bible change marks its shots `stale`.
- **Hosted jobs take a `plan` slot** (network-bound), not a `generate`
  slot, so a Mac can wait on eight hosted shots while it renders.
- **Progress lines name the shot** (`shot 4/9: guided, attempt 2`), as long
  form names the chapter, so an app can show real progress
  (`src/progress.js`).

## 8. Gates and measurement

### 8.1 Gates that already cover character stories

These run in `finish` today (`src/finish.js`) and apply unchanged to the
animatic and to any rig shot:

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
- add what dialogue needs: speaker turns per minute, seconds per line,
  the share of time on a listener's reaction, and the longest stretch on
  one framing;
- a 9:16 Shorts variant, since character Shorts cut faster than a
  three-minute story.

**Layout.** The layout check works from the modules' own rectangles, which
a generated shot does not have. Two cases:

- *Guided.* The rig's rectangles still describe the shot, because the model
  was steered by them. The silhouette check in §5.4 confirms the model
  stayed inside them. Layout results then carry over from the animatic.
- *Generative.* The shot is treated as footage. The footage lane already
  tracks faces and keeps cards and captions off them (`src/face_clear_fit.js`,
  the `face` gate in `src/quality_gates.js`), and `finish` measures caption
  legibility on the rendered frames. Whether the face tracker finds drawn
  faces is unproven. Where it cannot, the gate is `not-checked` with a
  reason.

**Critic.** The same rubric and receipts, with the reference sheets beside
the frames, and the `acting`, `character-consistency` and `lip-sync`
categories (§4.7). The animatic gets its own earlier review, limited to
story, staging and acting.

**New gates.**

| Gate | Fails when | Applies to |
|---|---|---|
| `screenplay` | a speaker is unknown; a character never speaks or acts; the script is over its length; the problem lands late | all |
| `bible` | the story's cast differs from the frozen bible; a sheet is missing; the hash is wrong | all |
| `conform` | a produced clip differs from the animatic in frames, rate or size | guided, generative |
| `identity` | a character fails its sheet check (§5.4) | guided, generative |
| `continuity` | adjacent shots in one place disagree on who is where, or their colours drift apart | guided, generative |
| `lip-sync` | mouth movement inside a speaker's matte does not follow the speech; `not-checked` where it cannot be measured | all |
| `provenance` | a generated clip has no record of provider, model, version, seed and licence | guided, generative |

Every gate reads only the project and calls no model, except the identity
judge, which is recorded as a paid call when it is one. Repairs fix the
shot and never the gate.

### 8.3 Measuring parity for animation

The method is MAKE_SKILL_PARITY.md's: a fixed set of briefs through both
paths, compared from the files they leave.

**Briefs.** Six, each a 30–45 second 9:16 Short on the `rig` lane:

1. two characters, a problem and a fix (a product story);
2. `pov`: one character caught in the viewer's situation;
3. `last-time`: two characters in an ordinary moment;
4. an argument: two characters who disagree, mostly dialogue;
5. a silent story: almost no dialogue, all acting;
6. three characters, one of whom barely speaks.

**Metrics, per video:**

- contracts: each of the files in §4 validates, and how many repair passes
  it took;
- story: lines per character, the share of silent lines, when the problem
  lands;
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
  and both must produce a valid screenplay, a frozen bible and a direction
  map that use the same vocabulary.
- The format scorecard (`npm run eval:formats`, `eval/formats.mjs`) gains
  the animation briefs.

The generative lanes are measured separately, by shot: identity pass rate
on the first attempt, attempts per shot, fallbacks, seconds and dollars per
finished second. Those numbers decide whether a lane is worth its cost.

## 9. Delivery plan

Small PRs, each green on its own, stacked in order. Phases 1–8 are the
vertical slice: **one prompt to a 30-second Short with two characters on
the code-drawn lane, with the critic loop.** Phases 9–15 add the guided
lane behind the provider interface. Phase 16 is everything after.

### The vertical slice

**Phase 1. The screenplay contract.**
- Scope: the schema, validation, and the conversion to
  `audio.narration.lines`. `launchclip screenplay check <project>`.
- Files: `kit/core/screenplay.mjs` (new), `src/screenplay_cli.js` (new),
  `src/cli.js`, `src/cli_usage.js`, `test/screenplay.test.js`,
  `docs/KIT_CONTRACTS.md`.
- Done when: a hand-written two-character screenplay validates; each rule in
  §4.1 has a failing fixture; `launchclip voice` voices the derived lines in
  two voices with speakers on every word.

**Phase 2. The show bible.**
- Scope: the schema, validation, `launchclip bible freeze | show`, a sheet
  per character, `must_keep` derived from rig parameters, the `bible` key on
  the story and the direction map, the `bible` gate.
- Files: `kit/core/bible.mjs` (new), `src/bible.js` (new), `src/cast.js`
  (per-character sheets), `kit/core/story.mjs` (`TOP_LEVEL`,
  `STORY_REVISION`), `kit/core/direction.mjs`, `src/finish.js`,
  `test/bible.test.js`.
- Done when: freezing a bible writes sheets and a hash; a story whose cast
  differs from its bible fails the gate; an old story with no bible still
  validates.
- Depends on the saved character file from the cast-designer work. Until it
  lands, the bible takes starter and generated characters only.

**Phase 3. Shot fields.**
- Scope: the `production` block, `line` on map lines, the "speaker is on
  screen" rule, `launchclip story shots`.
- Files: `kit/core/story.mjs`, `kit/core/module-schemas.mjs`,
  `kit/core/direction.mjs`, `src/story_cli.js`, `test/direction.test.js`,
  `examples/story/` (a two-character dialogue example).
- Done when: the example validates and renders in both renderers within
  parity; `story shots` lists its shots; a line spoken off screen with no
  `why` fails.

**Phase 4. Writers' room in `make`.**
- Scope: `format: "animation"` in routing, `--animation`, and the three
  writing calls with one repair pass. Stops after the screenplay and voice.
- Files: `src/make/routing.js`, `src/make/options.js`,
  `src/make/animation.js` (new), `src/make/index.js` (`stagePrepare`),
  `test/make_animation.test.js`.
- Done when: with recorded model responses, `make "<prompt>" --animation`
  writes a valid `SCREENPLAY.json` and a `NARRATION.json` with two speakers,
  and a rerun reuses both.

**Phase 5. Bible and planning in `make`.**
- Scope: `stageBible`, then the existing direction and storyboard planning
  with the bible pinned and the screenplay in the brief.
- Files: `src/make/index.js`, `src/make/animation.js`,
  `src/storyboard_planner.js` (the brief, the pinned cast), `src/cast_fit.js`
  (never rename a bible's cast).
- Done when: the fixture plans a storyboard that passes `story validate`,
  the `cast` gate and the `bible` gate, and a replan cannot change who is in
  the story.

**Phase 6. The animatic and the critic loop.**
- Scope: `finish --animatic`, `ANIMATIC.json`, the staging review, the
  sheets in the critic's evidence, the new finding categories,
  `qa/retakes.json`, and retake steps 2 and 4 from §4.7.
- Files: `src/finish.js`, `src/make/index.js` (`stageAnimatic`,
  `criticRepairs`), `src/make/critic.js`, `src/make/critic_repair.js`,
  `skills-src/references/cinematic-production.md`,
  `test/make_critic_repairs.test.js`.
- Done when: one prompt produces a 30-second Short with two characters and
  dialogue; the report is `ready` on a `ship` verdict or `needs-repair`
  after three rounds; a seeded bad shot is fixed by a retake that re-renders
  only that shot.
- **This is the end-to-end slice.**

**Phase 7. The skill path.**
- Scope: an animation branch in the quick path, a generated
  `references/animation.md` (the screenplay, the bible, the shot list), and
  the parity contract test.
- Files: `skills-src/`, `scripts/sync-skills.mjs`, both create-video skills
  (generated), `test/animation_paths.test.js`.
- Done when: `npm run skills:check` is green; an agent given only the skill
  and a new brief produces the same contracts and a finished Short; the
  contract test passes.

**Phase 8. Measurement and mouths.**
- Scope: the six briefs and their metrics in the scorecard; the
  `story-characters` profile measured from references, with the dialogue
  measures; phonemes kept in `NARRATION.json` and mouth shapes on the rig;
  the `screenplay` and `lip-sync` gates.
- Files: `eval/formats.mjs`, `eval/formats.json`, `eval/fixtures/`,
  `kit/profiles/story-characters.json`, `kit/profiles/PROVENANCE.md`,
  `kit/core/cadence.mjs`, `src/voice/kokoro.js`, `src/voice/dialogue.js`,
  `kit/core/characters/acting.mjs`.
- Done when: both paths run the six briefs and the parity table is
  published in `benchmarks/`; the profile lists its references; a rig
  character's mouth shapes follow its phonemes in both renderers.
- Mouth shapes touch the acting code, so this part is agreed with the
  acting-quality work first.

### The guided lane

**Phase 9. The spike. No product code.**
- Scope: by hand, take three shots from the phase 6 Short. Export the
  control passes with a script. Run each through two local and two hosted
  options. Then do the same for a six-shot sequence with both characters.
- Measure: identity across shots (by eye, and with the §5.4 checks), pose
  adherence, flicker, style match, lip sync with and without a lip-sync
  pass, seconds and dollars per finished second, and memory on a Mac.
- Files: `benchmarks/animation-lanes/` (results and the scripts used).
- Done when: the results are written up with a go or no-go for the guided
  lane, the provider to build first, and the Mac it needs. **The owner
  decides here whether phases 10–15 proceed.**

**Phase 10. The capability check.**
- Files: `src/capabilities.js` (new), `src/doctor.js`, `src/cli.js`,
  `src/make/index.js` (`stageCapabilities`, `MAKE.json` `lanes`),
  `test/capabilities.test.js`.
- Done when: `doctor --lanes --json` is correct for each combination of
  keys and runtimes in the tests, makes no paid call, and `make` prints the
  lanes before planning.

**Phase 11. The provider interface.**
- Scope: the `shots` adapter key, the registry, the `test` provider, the
  command provider, `SHOT.json`, the per-shot cache, the `conform` and
  `provenance` gates, `launchclip shots`, `stageShots`, and clip playback in
  the resolved story.
- Files: `src/shots/index.js`, `src/shots/test_provider.js`,
  `src/shots/command_provider.js`, `src/shots/record.js` (all new),
  `src/engine/adapters.js`, `src/finish.js`, `src/render_segments.js`,
  `src/make/index.js`, `packages/engine/README.md`.
- Done when: `make --lane guided --shot-provider test` produces a video
  identical to the rig lane's, with a record per shot; a second run
  generates nothing; killing the run mid-shot and rerunning resumes it.

**Phase 12. Control passes.**
- Scope: `reference`, `pose`, `line`, `matte` and `depth` on Remotion, then
  the whole-video form on HyperFrames. `launchclip shots passes <project>
  --scene <id>`.
- Files: `kit/core/characters/passes.mjs` (new), `kit/remotion/`,
  `kit/hyperframes/`, `src/shots/passes.js` (new),
  `test/fixtures/parity/characters-pass-*.json`.
- Done when: every pass for the example shot matches its golden stills; the
  matte's silhouette equals the rig's drawing bounds
  (`kit/core/characters/bounds.mjs`); passes are frame-aligned with the
  animatic.

**Phase 13. The identity check.**
- Scope: the measured layer, the judge, the `identity` and `continuity`
  gates; the embedding layer only if the spike showed it adds signal.
- Files: `src/shots/identity.js` (new), `src/quality_gates.js`,
  `src/make/critic.js`, `test/shot_identity.test.js`, fixtures with
  deliberately wrong characters.
- Done when: fixtures with a wrong outfit, a wrong skin tone, a dropped
  headscarf and an extra person all fail; the rig's own render passes; a
  missing vision model gives `not-checked` with a reason.

**Phase 14. The first real providers.**
- Scope: the one local and the one hosted provider the spike chose, opt-in,
  with estimates; the `generate` slot; shot jobs in the job store; resume
  of submitted jobs; the budgets of §5.6.
- Files: `src/shots/<provider>.js` (new), `src/capacity.js`,
  `src/queue.js`, `src/job_store.js`, `src/cost_tracker.js`,
  `benchmarks/animation-lanes/`.
- Done when: the phase 6 Short renders on the guided lane on the reference
  Mac and through the hosted provider; nothing is spent without the flag;
  the estimate is within 25% of the bill.

**Phase 15. Retakes, fallback and the guided parity run.**
- Scope: retake steps 1 and 3, the `uniform` and `mixed` policies, the
  deadline, and the per-shot metrics of §8.3.
- Files: `src/make/critic_repair.js`, `src/shots/index.js`,
  `src/make/index.js`, `eval/formats.mjs`.
- Done when: a shot that fails identity three times falls back and the
  report says so; a run with no provider finishes on the rig lane; the six
  briefs have guided-lane numbers beside the rig lane's.

### After

**Phase 16**, each its own RFC or PR series, ordered by what the spike and
the parity runs show: the generative lane; a lip-sync pass on generated
clips; the remote node; a local vision critic; series bibles shared across
a collection; animation longer than three minutes, by chapter, on the
long-form plan.

### Dependencies

- Phases 1, 2 and 3 can run side by side.
- Phase 4 needs 1. Phase 5 needs 2, 3 and 4. Phase 6 needs 5.
- Phases 7 and 8 need 6 and can run side by side.
- Phase 9 needs 6. Phase 10 can start any time.
- Phases 11 and 12 need the go from 9 and can run side by side.
- Phase 13 needs 12. Phase 14 needs 11, 12 and 13. Phase 15 needs 14.

## 10. Risks

| Risk | What this RFC does about it |
|---|---|
| The generated lanes never hold a character | The slice ships without them; the spike decides before anything is built; the rig lane is always the fallback |
| Small local models write weak screenplays | Each writing step is small and validated; the skeleton carries structure; the parity run measures it per model tier |
| Costs run away on retakes | Estimates first, a cap that defaults to zero, three attempts per shot, a deadline |
| A video mixes two looks | The `uniform` policy |
| A model erases a headscarf or changes a skin tone | `must_keep` is a hard failure with no override |
| Contracts multiply and drift apart | Two new files and additive fields only; one validator each; skills generated from the same registry |
| Three parallel sessions change the cast, acting and style code underneath | The bible points at their files and never defines their shape; phases 2 and 8 name the dependency |

## 11. Open questions

For the owner:

1. **Screenplay file.** A new `SCREENPLAY.json` beside `SCRIPT.json`, as
   proposed, or one script file that grows speakers and silent lines?
2. **One look per video.** Is `uniform` the right default, and at what share
   of fallen-back shots does the whole video drop a lane?
3. **Review stops.** Should an attended run stop for approval after the
   bible and after the animatic (a `--stop-after bible | animatic`), and
   should an unattended `make` continue on the critic's word alone?
4. **Spending.** Is a $0 default cap for generated shots right, so that
   every paid shot needs a flag?
5. **What leaves the machine.** Is per-run opt-in enough before sheets and
   control passes go to a hosted provider, or should it be a setting on the
   library?
6. **The local bar.** Which Mac is the reference machine for the guided
   lane, and how long may a 30-second Short take on it?
7. **First local runtime.** A ComfyUI server over HTTP (large community,
   every model, an extra install) or a native runtime LaunchClip manages
   (one install, far fewer models)?
8. **Guided compositing.** Restyle the whole frame, or generate characters
   only and keep the world code-drawn under them?
9. **Lip sync for the first release.** Are mouth shapes from phonemes on the
   rig enough to ship, with generated-shot lip sync left as research?
10. **A critic with only an Anthropic key.** `make`'s Anthropic adapter
    sends no images, so there is no critic and no identity judge. Add vision
    to it, or require a second key?
11. **The sprite lane.** Keep it as its own form, or fold it into the guided
    lane's key frames once that exists?
12. **Per-character fine-tuning.** If the spike shows references are not
    enough, is training a small adapter per character acceptable, given the
    time and the files it adds to a project?
13. **Narrator.** Do character Shorts default to pure dialogue, or a
    narrator with dialogue?
14. **Series.** Should a bible live in a collection so every episode shares
    its cast and voices?
15. **The remote node.** In scope for this line of work, or its own RFC?
16. **Real people and children.** The quality RFC allows a character based
    on a real person only at that person's request. Do generated lanes need
    a stricter rule, and are there limits for stories with child characters?

## 12. Non-goals

- **Training or fine-tuning models.** Open question 12 may reopen it.
- **Shipping model weights in the npm package.** Models are downloaded on
  request or reached over an address, like the matting models.
- **Choosing a model.** §5.7 lists examples; the interface is the decision.
- **A timeline or shot editor.** Editing stays in chat, the storyboard and
  the NLE exports.
- **Photoreal people, or anyone's likeness.**
- **Replacing the renderers or the storyboard contract.** Every addition is
  a field, a file, a gate or an adapter.
- **Animation over three minutes** in this plan. It follows on the long-form
  chapters once Shorts are good.
- **Changing the skill for other kinds of video.** The animation branch is
  additive.
- **The character kit itself.** New character families, livelier acting,
  `cast create` and `cast edit`, and style analysis from references are
  separate work. This RFC consumes them.
