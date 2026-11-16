# RFC: Generating handed-in footage with a model

Status: draft for review; nothing here is scheduled
Date: 2026-11-16
Builds on: [ANIMATION_PIPELINE_RFC.md](ANIMATION_PIPELINE_RFC.md) (the show
bible §4.2, the animatic §4.4, the hand-in contract §5, approval §6.3),
[KIT_CONTRACTS.md](KIT_CONTRACTS.md)

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
- Drafts before finals: a cheap low-resolution pass for every shot, a full
  resolution pass only for approved drafts.
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
script → bible (frozen) → shot list → animatic ─┬─ hand-in (files or provider hook) ─┐
                                                └─ generate (this RFC) ──────────────┤
                                                                                     ▼
                                                       handin check → finish → gates
```

The generator is an asset provider. It answers the same requests the
asset-provider hook answers today (`findShot(request) → shot | null`,
`src/asset_provider.js`, `--asset-provider-cmd`), extended for character
shots and plates as §5.3 already plans, and it writes `HANDIN.json` with
`source: {made_with, licence, generated: true}`. `null` still means "draw
it in code".

So the generator adds no new render path, no new look rules and no new
gate. It adds a brief, a ledger, a money gate and provider adapters.

## 4. The generation brief

The brief is built from what the project already has after the animatic,
so the model is told exactly what the animatic shows.

| Field | From |
|---|---|
| Start frame | the shot's first frame from the animatic, rendered at the provider's size; the image-to-video first frame |
| Character description | the bible's character entry, written out once as a fixed paragraph (silhouette, proportions, colours as hex, signature item, gesture, `must_keep`, the fixed imperfection), pasted word for word, never shortened |
| Reference images | the bible's sheets for every character in frame, the crop the provider accepts |
| Place | the bible's world entry and its light; for a plate, the place alone with nobody in it |
| Action | the shot's one action, timed in beats from the shot list (`0–2 s: …`, `2–5 s: …`) |
| Camera | the shot's camera move, in camera words (shot size, angle, movement) |
| Length, size, rate | the shot's frame count, the story's size and rate, plus edge padding (§6) |
| Never | no text or lettering, no extra people, no mirrors, the bible's `rules` |

Rules for the brief, enforced when it is written:

- **One action per shot.** A shot with two actions in the shot list is
  split before generation, or generated as code-drawn.
- **The scene lives in the frame, the motion in the prompt.** The motion
  prompt describes only motion and camera; who, where and the light come
  from the start frame and the references.
- **The description is the bible's, not the model's.** The planner never
  paraphrases a character inside a prompt. A variant (a character covered in
  flour) is its own bible entry with its own sheet.
- **Plates are per place**, generated once and reused in every shot there.

`launchclip generate brief <project> [--shot s3] [--json]` prints the brief
without calling anything, so a person can paste it into any tool by hand.
That is useful on its own and costs nothing.

## 5. Providers

A provider is an adapter with four calls:

```js
{
  id: 'name',
  kinds: ['plate', 'shot'],               // what it can make
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

## 6. Money, drafts and approval

- **Quote first.** Before any paid call, the generator quotes the whole
  batch (every shot, every tier) and prints it. Attended, it asks. Headless,
  it needs `--budget <n>` and refuses to start a batch whose quote is over
  it.
- **A running budget.** Spend is counted per project and per day; the
  generator stops when the next call would pass the budget, and the rest of
  the shots fall back to code-drawn, with the reason in the report.
- **Drafts, then finals.** Tier `draft` renders every shot at low
  resolution. The animatic-style review (§6.3) is shown again with the
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
{ "shot": "s3", "tier": "draft", "attempt": 2,
  "provider": "name", "model": "model-id", "seed": 1234,
  "brief_hash": "sha256:…", "bible_hash": "sha256:…",
  "changed": "the antenna bends right, not left",
  "cost": {"amount": 20, "unit": "credits"}, "seconds": 41,
  "file": "assets/shots/s3.draft.2.mp4",
  "verdict": "rejected", "reason": "antenna bent the wrong way" }
```

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
  params and frozen with the bible, in the fixed order of §4.
- **A fixed imperfection**: one small deliberate flaw kept in `must_keep`,
  so the vision check and a person can spot drift at a glance.

For characters a user designs themselves, `launchclip cast` should produce
the same: the sheet (front, both profiles, back, a three-quarter pose), the
description and the flaw.

## 9. Delivery plan

1. **The brief only.** `generate brief`, the written description and the
   fixed imperfection in the bible. No provider. Done when a brief pasted by
   hand into an image-to-video tool gives a shot that passes `handin check`
   on a fixture story.
2. **The command provider, the ledger and the money gate.** Quote, budget,
   approval, retries with one changed line, edge padding. Done when a fake
   provider (a fixture command) drives a whole story through drafts and
   finals, with spend stopped at the budget and the rest code-drawn.
3. **One local provider.** Done when a Short renders on one Mac with no
   network and no key.
4. **One hosted provider, and the skill path.** Chosen after phase 3, by
   price per second of final video and how well it holds a character from a
   start frame.

## 10. Risks

- **Character drift is the whole problem.** The bible check catches gross
  failures, not likeness (§5.4). One look per video (§5.5) means one bad
  shot can send the whole story back to code-drawn; that is the intended
  safe failure, but it can waste a budget. `--look mixed` stays opt-in.
- **Cost surprises.** Provider prices change and quotes can be wrong. The
  budget is enforced on spend recorded after each call, not only on the
  quote.
- **Licensing.** Generated output terms differ by provider. `source.licence`
  is required and comes from the adapter, never guessed.
- **Scope creep into hosting.** Queues, accounts and billing stay out; the
  ledger and the budget are per project and local.

## 11. Open questions

- Which local video model is good enough on Apple silicon to be the
  default local provider, if any is yet.
- Which hosted provider to write first, and whether one adapter can cover
  aggregators that front many models.
- Whether sprite casts (pose, talk and blink sprites) are worth generating,
  or whether plates and whole shots cover the useful cases.
- Whether the draft review should be the animatic with drafts swapped in,
  or a contact sheet of first, middle and last frames per shot.
- How the agent's own tools (skill path) report cost back into the ledger.
