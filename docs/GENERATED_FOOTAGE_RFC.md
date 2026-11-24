# RFC: Generating handed-in footage with a model

Status: draft for review; nothing here is scheduled
Date: 2026-11-16 (revised 2026-11-20: footage requests, two-step flow,
providers)
Builds on: [ANIMATION_PIPELINE_RFC.md](ANIMATION_PIPELINE_RFC.md) (the show
bible §4.2, the animatic §4.4, the hand-in contract §5, approval §6.3),
[KIT_CONTRACTS.md](KIT_CONTRACTS.md), the asset-provider hook
(`src/asset_provider.js`)

## 1. Summary

Today LaunchClip never asks a model to make pictures or video. Plates,
sprite casts and whole shots are handed in, and LaunchClip checks them
against the bible and falls back to the code-drawn version when they fail
(ANIMATION_PIPELINE_RFC.md §5.2: "LaunchClip does not ask a model to make
these assets"). That stays the default.

This RFC proposes an **opt-in generator**: a flag on the CLI and the skill
that turns each shot the animatic has fixed into a generation brief, sends
it to an image or video model the user chooses, and writes what comes back
into the hand-in contract as if the user had handed it in. Everything after
that (validation, the bible check, fallback, one look per video, caching)
is the existing hand-in path, unchanged.

It answers two kinds of request:

- **Story shots**: plates and whole character shots in an animated story,
  fixed by the bible and the animatic. Holding the character is the hard
  part.
- **Footage shots**: the B-roll a motion-graphics story already asks for
  with `{kind: "shot", shows, type}` (clip, photo-scene and media-window
  scenes, media layouts, card image slots, card backdrops). Today only an
  app's media library answers these; the generator can answer them too.
  No character to hold, so this is the easier and wider case.

Both use the same two steps: **text to image** makes a keyframe, and
**image to video** animates it only when the request wants video. The
keyframe is the cheap draft a person or the check approves before any
video is paid for.

The idea comes from how AI animation series are made by hand: direct
everything on paper and in stills first, lock the character, render cheap
drafts, and pay for a final only once a draft is approved. LaunchClip
already does the first half (bible, sheets, animatic). The generator adds
the second half without making it the engine's job to host, queue or bill.

## 2. Goals and non-goals

**Goals**

- One flag turns hand-in into generate-then-hand-in, on `make`, on
  `finish`, and on the skill path.
- Every generated asset passes through the same checks as a handed-in one
  (§5.4), and a failure falls back to the code-drawn shot (§5.5).
- No money is spent without a quote, a budget and an approval.
- Drafts before finals: a keyframe (and, for video, a cheap low-resolution
  clip) for every shot, a full resolution pass only for approved drafts.
- A generated shot can be made again: every attempt is logged with its
  brief, provider, model, seed, cost and verdict.
- Providers are adapters. Swapping one is a flag, not a code change.
- Local models are a first-class provider, in keeping with running the
  whole pipeline on one machine (ANIMATION_PIPELINE_RFC.md §7).

**Non-goals**

- Hosting, queues across machines, accounts, billing and credit balances.
  Those belong to the host application, as scale does today.
- Shipping an API key, a default paid provider, or any provider being
  required. With the flag off nothing changes and no key is needed.
- Generating captions, cards, the brand frame or UI. Those are always drawn
  in code (§5.1), and a set's screen always plays the user's own capture.
- Lip sync. A generated whole shot has the same limit as a handed-in one
  (§5.6).

## 3. Where it plugs in

```
Story shots:
script → bible (frozen) → shot list → animatic ─┬─ hand-in (files or provider hook) ─┐
                                                └─ generate (this RFC) ──────────────┤
                                                                                     ▼
                                                       handin check → finish → gates

Footage shots:
script → storyboard with {kind: "shot"} requests ─┬─ media library (findShot) ─┐
                                                  └─ generate (this RFC) ──────┤
                                                                               ▼
                                                     storyboard check → render
```

The generator is an asset provider. It answers the same requests the
asset-provider hook answers today (`findShot(request) → shot | null`,
`src/asset_provider.js`, `--asset-provider-cmd`), extended for character
shots and plates as §5.3 already plans. A story shot is written into
`HANDIN.json` with `source: {made_with, licence, generated: true}`; a
footage shot comes back as a `shot` with `file` and the same `source`.
`null` still means "draw it in code" for a story shot, and "design the
scene without footage" for a footage shot, as it does today.

A generator can sit behind a library: ask the library first, generate
only what it has no match for.

So the generator adds no new render path, no new look rules and no new
gate. It adds a brief, a ledger, a money gate and provider adapters.

## 4. The generation brief

Every shot is made in two steps, each with its own half of the brief:

1. **Keyframe (text to image).** Who, where, the light, the look and the
   composition. The output is a still at the story's size.
2. **Motion (image to video).** Only when the request wants video. The
   keyframe is the start frame, and the prompt describes only motion and
   camera.

The keyframe is checked before step 2 (the bible check for a story shot,
the vision check against `shows` for a footage shot). A rejected keyframe
is retried as a still, which costs a fraction of a clip. A request for an
image, or a card slot that shows a still, stops after step 1.

### 4.1 Story shots

The brief is built from what the project already has after the animatic,
so the model is told exactly what the animatic shows. The animatic frame
is a layout reference for the keyframe, not the start frame itself: a
code-drawn frame animated as is would keep the code-drawn look.

| Field | From |
|---|---|
| Layout reference | the shot's first frame from the animatic, passed as a composition reference to the keyframe step where the provider accepts one, otherwise described in words (shot size, who is where) |
| Start frame | the approved keyframe; the image-to-video first frame. With continuity on, a shot that carries straight on from the one before starts on that clip's last kept frame instead (§4.1.2) |
| Character description | the bible's character entry, written out once as a fixed paragraph (silhouette, proportions, colours as hex, signature item, gesture, `must_keep`, the fixed imperfection), pasted word for word, never shortened |
| Drawing | the drawing style's locked paragraph (`src/generate/style-paragraphs.js`): the figures' line, palette, light and what they never do, then the place drawn the same way; for a stick or rubber-hose style, its anatomy as constraints too. A plate gets the place sentence only |
| Reference images | the bible's sheets for every character in frame, the crop the provider accepts |
| Place | the bible's world entry and its light; for a plate, the place alone with nobody in it |
| Action | the shot's one action, timed in beats from the shot list (`0–0.5 s (setup): …`, `0.5–1.1 s (action): …`), as cause and effect |
| Camera | the shot's camera move, in camera words (shot size, angle, movement) |
| Audio | none by default: no music, no speech or narration, no sound effects (`video.audio: "none"`); with `--generate-sound-effects` or the storyboard's `generate.sound_effects`, the model's own effects only (`"effects"`). An adapter whose model takes an audio switch sets it from this |
| Length, size, rate | the shot's frame count, the story's size and rate, plus edge padding (§6) |
| Never | no text or lettering, no extra people, no mirrors, the style's anatomy negatives (stick, rubber-hose), the bible's `rules` |

Rules for the brief, enforced when it is written:

- **One action per shot.** A shot with two actions in the shot list is
  split before generation, or generated as code-drawn.
- **The scene lives in the frame, the motion in the prompt.** The motion
  prompt describes only motion and camera; who, where and the light come
  from the keyframe and the references.
- **The description is the bible's, not the model's.** The planner never
  paraphrases a character inside a prompt. A variant (a character covered in
  flour) is its own bible entry with its own sheet.
- **Plates are per place**, generated once and reused in every shot there.
- **The drawing is locked.** One fixed paragraph per drawing style, pasted
  word for word into every keyframe and plate of the story, never
  rephrased per shot: the scene varies, the drawing does not. It is part of
  the hashed brief, so editing a paragraph makes every shot in that style a
  new brief. A style whose figures are lines (stick, stick-classic,
  rubber-hose) also says its anatomy in the prompt, for models that ignore
  the negative: exactly two arms and two legs, a raised arm replaces the
  lowered one rather than adding a third, every limb connected, the spine
  one thin line, no filled torso, no yellow face, no 3D shading; the same
  list goes into the negative for that style only, and one line of it into
  the video prompt. A new style with no paragraph yet gets its name in one
  sentence until it is given one.
- **Action as cause and effect.** Each timed beat names only what changes
  (a pose, an expression, the action and its target, a prop gripped or let
  go, a contact, a hand-off, a camera move), labelled setup, action (the
  beat the shot's action lands on), consequence and reaction, so each beat
  follows from the one before and the last one earns its hold. Cue fields
  (`holds`, `contact`, `to`, `target` on a pose state) are read when a state
  carries them and never required. The motion prompt ends with a narrow
  continuity line (who is in frame, where they stand and the light stay as
  in the start frame; nothing moves that the beats do not name) rather than
  "nothing else moves", which also froze the action's own consequences.
- **The mix is ours.** Narration, music and effects are laid in the edit,
  so the video prompt says no music and no speech, and no effects unless
  the story keeps the model's own.

#### 4.1.1 One generation clip, several edited shots (designed, not built)

A *generation clip* is one returned model asset; an *edited shot* is a
continuous view the final timeline keeps. Today they are one-to-one: one
shot of the shot list is one brief, one clip, and the edit keeps the clip
less its edge padding. Many models now make 8–15 s per call and do better
with a few connected beats than with one 2 s action, so the next step is to
plan the timeline first and group it into clips:

1. **Timeline first.** The shot list (from the animatic) is the final
   timeline. Consecutive shots in the same set, with someone in both and
   action that carries over, are grouped into one generation clip up to
   the chosen model's longest supported length; a cut to another place, a
   new character, or a shot that must be code-drawn closes the group. No
   fixed clip length or count: the model's real settings decide.
2. **One brief per group.** The group's beats are the shots' beats laid
   end to end on the clip's own clock, with the camera change at each shot
   boundary said as a cut or a move ("2.5–5 s cut closer: …").
3. **A retained-range ledger.** Before generating, each edited shot is
   mapped to a source range of its clip; after, the ranges are checked
   against the returned clip and updated:

   | Final timeline | Edited shot | Source clip | Requested / actual length | Kept in–out | Join and carried state |
   |---|---|---|---|---|---|

   HANDIN.json then names one clip for several shots, each with its own
   `source_start` (and `source_end`), and unused stretches are discarded.
   Generated length is not kept length: 30 s generated does not make a
   30 s film.

What exists now is the one-to-one case of that ledger: every video ledger
line records `retained: {in, out}` (the pad trimmed off each end, §6), and
HANDIN.json's `source_start` is its `in`. Grouping is left designed: it
changes the brief's unit from a shot to a group, which touches the shot
list, the hand-in manifest and the per-shot retakes, and is its own change.

#### 4.1.2 Continuity between clips

A cut between two generated clips joins only if the action, the pose, the
grip, the prop and the screen direction carry across it. A keyframe made
fresh for each shot redraws all of them, so consecutive shots that carry
straight on are chained instead:

- **Opt-in.** `finish --generate-continuity`, or `generate.continuity:
  true` in the storyboard (which `generate brief` and the skill path read,
  so their hashes agree). Off by default; nothing changes without it.
- **Which shots.** A shot continues the one before when they share the set,
  there is no gap between them (within a frame), someone is in both, and
  the shot before is generated too (a code-drawn shot has no clip to take a
  frame from).
- **The brief.** `video.continue_from` names the shot before, and the
  motion prompt opens with the carried state: each shared character as it
  left off (its last pose, expression and held prop), same side of frame
  and facing the same way. The brief hash covers it.
- **The start frame.** The generator starts the clip on the last kept
  frame of the shot before (`pad + seconds − one frame` of that clip),
  written to `assets/shots/generated/<id>/start-from-<prev>.png`, and the
  ledger line records `start_frame: {shot, at}`. When that clip was not
  made in this run, or its frame cannot be read, it falls back to its own
  keyframe with a note. The keyframe is still made and checked: it is the
  fallback and the bible check. A cached chained clip is reused even if the
  shot before is remade; keying the cache on that clip is left until it
  matters.
- **Reference vs first frame.** A reference image conditions identity and
  style; a first frame is the literal opening composition. The bible's
  sheets stay references and the keyframe (or the chained frame) stays the
  first frame, the default. For a provider that takes reference images on
  the video step, sending the sheets as a style input there too is a
  follow-up behind its own flag; a start frame is never used for a picture
  that is not meant to be the opening.

The joins still need looking at: a prompt's intended continuity is not
evidence that the cut works. The draft review (§6) and `handin check` look
at each clip; checking the join itself (entry and exit pose, prop, camera
direction at the cut) is an open question (§11).

Provenance: the locked style paragraph, the stick anatomy constraints, the
cause-and-effect beats, the audio line, the generation-clip/edited-shot
split, the retained-range ledger and first-frame chaining are adapted from
the MIT-licensed "directing-stickman-videos" agent skill (its A1 prompt
structure, A7 four-block prompt contract and Model Engine production and
review references). A few anatomy and rubber-hose sentences are copied with
light edits; `style-paragraphs.js` marks them.

### 4.2 Footage shots

The request already carries most of the brief (`src/asset_provider.js`):
`shows`, `type`, the narration `line`, `duration`, `format` and whether
the slot shows a still.

| Field | From |
|---|---|
| Subject | `shows`, word for word: the planner already writes it concretely |
| Context | not the narration `line`: image models draw quoted words into the frame (seen with a real provider), so `shows` alone says what the shot is, and "no text" is said in the prompt as well as the negative, for models that ignore negatives |
| Look | the story's brand palette and look, written once per story as a fixed paragraph so every footage shot in a video matches |
| Composition | where captions and cards sit in that scene, so the keyframe leaves that area calm; a backdrop request asks for low motion and no strong subject |
| Motion | for video, one slow camera move or one action; a backdrop gets a slow pan or push only |
| Length, size | `duration` plus edge padding (§6), `format` |
| Never | no text, lettering, logos or UI; no real, named people; no shot the scenes either side already show |

Rules:

- **Not evidence.** A generated shot illustrates; it never stands in for
  a product, a screen, a person or an event the video makes a claim
  about. Requests that name a real product, person or place are left to
  the library or come back `null`.
- **One look per story.** Every generated footage shot in a video uses
  the same look paragraph and, where the provider allows, the same image
  model.

`launchclip generate brief <project> [--shot s3] [--json]` prints the brief
without calling anything, so a person can paste it into any tool by hand.
That is useful on its own and costs nothing.

## 5. Providers

A provider is an adapter with four calls:

```js
{
  id: 'name',
  steps: ['image', 'video'],              // text to image, image to video
  quote(brief, tier) → {cost, currency | 'credits', seconds?},
  submit(brief, tier) → job,
  poll(job) → {state, progress?},
  fetch(job) → {file, seed?, model}
}
```

Provider classes to support, in order of how little they need:

1. **Command.** Any program that speaks one JSON line per request on stdin
   and stdout, like `--asset-provider-cmd` today. Covers anything we have
   not written an adapter for.
2. **Local.** An open image or video model running on the same machine.
   Cost is time, not money; the quote reports seconds. macOS first.
3. **Hosted API with the user's own key**, read from the environment, never
   written into the project.
4. **The agent's own tools (skill path).** When the agent has a generation
   tool connected (for example through MCP), the skill writes the brief,
   the agent calls its tool, and the file is handed in. LaunchClip never
   sees the connection.

Choosing: `--generate <provider>[:<model>]`, with separate choices allowed
for stills and video (`--generate-image`, `--generate-video`). Draft and
final can name different models.

### 5.1 Hosted providers to look at first

Aggregators come first: one adapter reaches many models, so the choice
of model becomes a flag and we can compare models on our own fixtures
before writing anything model-specific. Both hosted options below are
asynchronous (submit, then fetch), which matches the four calls above.

| Provider | What it is | Notes |
|---|---|---|
| fal.ai | aggregator: many image and video models behind one API and key | the first adapter; covers most of the models below |
| ElevenLabs Image & Video API | aggregator: models from Google, OpenAI, ByteDance and others, at the same prices as its app | needs a Pro plan or above; ByteDance models are off by default over the API and need approval; some models are unavailable in the US; a natural second adapter for users who already use it for voice |
| Replicate | aggregator, similar to fal.ai | a fallback if a model is only there |

Models to compare through them (names as of 2026-11; versions and prices
move, so the adapter reads them from the provider, never from a table in
code):

- **Text to image, holding a character or a look across shots:** Google's
  Gemini image models and Imagen, OpenAI's image models, Black Forest
  Labs' Flux (Kontext takes reference images), Ideogram.
- **Image to video:** Google Veo, ByteDance Seedance, Kling, Runway (takes
  reference images), Luma, MiniMax Hailuo, OpenAI Sora.
- **Local, macOS first (provider class 2):** Flux for stills through MLX,
  Draw Things or ComfyUI; Wan, LTX-Video or HunyuanVideo for video, if any
  is good enough on Apple silicon (§11).

The table is a starting list, not a choice. Phase 4 (§9) picks by price
per second of final video, how well a model holds a character or a look
from a keyframe, and its output licence.

## 6. Money, drafts and approval

- **Quote first.** Before any paid call, the generator quotes the whole
  batch (every shot, every tier) and prints it. Attended, it asks. Headless,
  it needs `--budget <n>` and refuses to start a batch whose quote is over
  it.
- **A running budget.** Spend is counted per project and per day; the
  generator stops when the next call would pass the budget, and the rest of
  the shots fall back (story shots to code-drawn, footage shots to no
  footage), with the reason in the report.
- **Keyframes, then drafts, then finals.** Every shot's keyframe is made
  and checked first; only an approved keyframe is animated. Tier `draft`
  then renders every video shot at low resolution. The animatic-style review (§6.3) is shown again with the
  drafts in place. Only approved drafts get a `final`, generated from the
  same brief and seed where the provider allows it. `--stop-after drafts`
  and `--approve drafts` work like the existing approval points.
- **Retries change one thing.** A shot that fails the bible check is
  retried with one changed line in the brief, chosen from the check's
  finding. After three failed attempts it is not retried again; the report
  says the shot needs simplifying, and it falls back to code-drawn.
- **Edge padding.** Generated clips drift at their ends, so each shot is
  requested about 0.3 s longer at each end and `source_start` trims it
  back. The pad is a constant to tune on fixtures, not a promise.

## 7. The ledger

Every attempt is one line in `qa/generation-log.jsonl`:

```json
{ "shot": "s3", "step": "video", "tier": "draft", "attempt": 2,
  "provider": "name", "model": "model-id", "seed": 1234,
  "brief_hash": "sha256:…", "bible_hash": "sha256:…",
  "changed": "the antenna bends right, not left",
  "cost": {"amount": 20, "unit": "credits"}, "seconds": 41,
  "file": "assets/shots/s3.draft.2.mp4",
  "verdict": "rejected", "reason": "antenna bent the wrong way",
  "retained": {"in": 0.3, "out": 2.81},
  "start_frame": {"shot": "s2", "at": 2.777} }
```

A video line's `retained` is the source range the edit keeps (§4.1.1);
`start_frame` is there only for a chained clip (§4.1.2).

- An unlogged good shot cannot be made again, so a generated file without
  a ledger line is treated as handed in, not generated.
- The cache key is the brief hash, provider, model, tier and seed. Running
  `make` again reuses every accepted asset, as segments are reused today.
- `MAKE.json` sums the ledger into its costs, so a host sees spend per
  video.

## 8. Character reference sheets

Generation only works if the bible's character entry is good enough to
paste. The bible already has `must_keep`, a sheet and a fingerprint (§4.2).
The generator needs two additions, both useful without it:

- **A written description** per character, generated once from the rig
  params and frozen with the bible, in the fixed order of §4.1.
- **A fixed imperfection**: one small deliberate flaw kept in `must_keep`,
  so the vision check and a person can spot drift at a glance.

For characters a user designs themselves, `launchclip cast` should produce
the same: the sheet (front, both profiles, back, a three-quarter pose), the
description and the flaw.

Status: the description (`description` on each bible character, and in
`cast create`'s result) and the flaw (rig param `flaw`, in `must_keep`) have
shipped. The turnaround sheet (front, both profiles, back, three-quarter)
has not: the sheet still shows the poses and expressions.

## 9. Delivery plan

1. **The brief only.** `generate brief`, the written description and the
   fixed imperfection in the bible. No provider. Done when a brief pasted by
   hand into an image-to-video tool gives a shot that passes `handin check`
   on a fixture story.
2. **The command provider, the ledger and the money gate.** Quote, budget,
   approval, retries with one changed line, edge padding. Done when a fake
   provider (a fixture command) drives a whole story through drafts and
   finals, with spend stopped at the budget and the rest code-drawn.
3. **Footage shots through an aggregator.** The fal.ai adapter answering
   `{kind: "shot"}` requests (§4.2), behind the library when there is one.
   Done when a motion-graphics fixture story gets every footage shot
   generated in one look, inside the budget, with no text in any frame.
   This comes before the local and story-shot work because it has no
   character to hold and every motion-graphics story can use it.
4. **One local provider.** Done when a Short renders on one Mac with no
   network and no key.
5. **Story shots on a hosted provider, and the skill path.** The model is
   chosen by price per second of final video and how well it holds a
   character from a keyframe, compared through the aggregator adapters.

Status (2026-11-20): phase 5's story shots are built for any provider
(`src/generate/story.js`; `finish --generate`, and `make --animation
--generate`). Choices made where this RFC left them open:

- The drafts are the keyframes; with a draft video model
  (`--generate-draft-video`) they are draft clips too. `--stop-after drafts`
  stops before any render with HANDIN.json naming the plates and any draft
  clips (so `handin check` can look at them); the review is those files, not
  the animatic with drafts swapped in. Headless without `--stop-after`
  goes on to the finals (as at the bible and the animatic); attended, it
  asks.
- A keyframe is checked by the hand-in judge (`src/hand_in.js`
  `visionHandInJudge`) against the bible's sheets and must_keep; its first
  finding is the one changed line of the retry. With no vision model the
  keyframe is accepted unchecked, and the hand-in check marks the shot
  not-checked.
- A keyframe is reused across tiers, so a final animates the keyframe its
  draft was approved from.
- A plate brief with no place (a shot with no set) is not generated.

Status (2026-11-25): story briefs paste a locked paragraph per drawing
style, with anatomy constraints for stick and rubber-hose figures; beats
read as cause and effect; the video prompt says no music or speech, and
fal models with an audio switch get it off. Continuity chaining
(`--generate-continuity`) and the `retained` ledger field are built;
grouping several edited shots into one generation clip (§4.1.1) is
designed only.

## 10. Risks

- **Character drift is the whole problem.** The bible check catches gross
  failures, not likeness (§5.4). One look per video (§5.5) means one bad
  shot can send the whole story back to code-drawn; that is the intended
  safe failure, but it can waste a budget. `--look mixed` stays opt-in.
- **Cost surprises.** Provider prices change and quotes can be wrong. The
  budget is enforced on spend recorded after each call, not only on the
  quote.
- **Footage that reads as evidence.** A realistic generated clip can look
  like a recording of something that happened. The not-evidence rule
  (§4.2) keeps named products, people and events out, and
  `source.generated` stays on the shot so a host can label it.
- **Licensing.** Generated output terms differ by provider. `source.licence`
  is required and comes from the adapter, never guessed.
- **Scope creep into hosting.** Queues, accounts and billing stay out; the
  ledger and the budget are per project and local.

## 11. Open questions

- Which local video model is good enough on Apple silicon to be the
  default local provider, if any is yet.
- Whether the fal.ai and ElevenLabs adapters can share one shape (both are
  submit-then-fetch over many models), or need one each.
- Which image and video model pair to default to inside an aggregator, for
  footage and for characters (likely not the same pair).
- Whether the footage look paragraph comes from the brand frame alone, or
  needs its own entry in the story.
- Whether sprite casts (pose, talk and blink sprites) are worth generating,
  or whether plates and whole shots cover the useful cases.
- Whether the draft review should be the animatic with drafts swapped in,
  or a contact sheet of first, middle and last frames per shot.
- How to check a join between two generated clips (entry and exit pose,
  grip, prop and camera direction at the cut) rather than each clip alone.
- ~~How the agent's own tools (skill path) report cost back into the
  ledger.~~ Answered: the agent hands each attempt in with `launchclip
  generate record` (provider `agent`, model from `--made-with`). A tool
  that reports a cost passes it as `--cost <n><unit>`; otherwise the line
  carries `cost_unknown: true` with a zero amount, and `MAKE.json` costs show
  it as unknown (no USD estimate, a warning), never as free. No quote or
  budget is enforced on that path: LaunchClip cannot see the tool's prices,
  so the skill makes the agent ask the user before spending. Story shots
  wait for the hand-in path.
