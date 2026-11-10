# How long `launchclip make --speed draft` takes

The aim is a planned, playable 30-second video in under a minute, and in the
end in no longer than the video itself. This page says where the time of an
ordinary run goes, what the draft does about each part, and what was
measured.

## Where an ordinary run's time goes

Every model call and local step of an ordinary short video, in order. Each
row waits for the rows it names. "Production" is one job on an 8-core,
7.5 GB worker (`gpt-6.1-terra` at medium reasoning, an ElevenLabs voice,
footage from a library through an asset-provider command; 31 minutes in
all). "This machine" is the run measured below (`gpt-5.6-luna` at medium
reasoning, the local Kokoro voice, a prompt and nothing else).

| # | Step | Kind | Needs | Production | This machine |
|---|---|---|---|---|---|
| 1 | Inventory and asset descriptions | one model call a file, 4 at once | the assets | (none handed in) | 0 s |
| 2 | Research, when the brief calls for it | searches and model calls | the brief | off | off |
| 3 | Five concepts | 1 call | the brief | 114 s with 4 | 86.5 s with 4 |
| 4 | The judge | 1 call | 3 | | |
| 5 | The story | 1 call | 4 | 67 s with 6 | 117.9 s with 6 |
| 6 | The retention edit | 1 call | 5 | | |
| 7 | The script | 1 call | 6 | 45 s with 8 | 35.7 s with 8 and 9 |
| 8 | Script repair, when a check fails | 0–1 call | 7 | | |
| 9 | The voice | ElevenLabs, or local Kokoro | 7 | 4 s | about 8 s (one take, measured apart) |
| 10 | Resize, when the take runs over | 0–1 call, then 9 again | 9 | none | none |
| 11 | The seeded style | local | the route | under 1 s | under 1 s |
| 12 | The direction map | 1 call, 0–1 repair | 9 (word timings) | 252 s for 12–15 | 29 s, then a 15 s repair |
| 13 | The storyboard | 1 call | 12 | | 33 s |
| 14 | Shot lookups | the asset provider, one after another unless `LAUNCHCLIP_ASSET_PROVIDER_CONCURRENCY` | 13, again in each repair | about 120 s of the 252 s | no provider |
| 15 | Storyboard repairs | 0–4 calls | the checks on 13 | | 3 repairs: 22 s, 31 s, 22 s |
| | **The plan is ready** | | | **about 500 s** | **392 s** |
| 16 | Candidate openings | 1 design call, stills, 2 judge calls | 15 | 71 s | not run |
| 17 | The render (voice, captions, sound, render, master, gates) | local | 15 | 498 s | not run |
| 18 | The critic, one repair round, the second render | vision calls, 15 and 17 again | 17 | about 12 min | not run |

Rows 3 to 8 and 12 to 15 are chains: each call needs the one before it, so
running calls side by side cannot shorten them (benchmarks/MAKE_CONCURRENCY.md).
A faster first look has to make fewer calls, and smaller ones.

## What the draft does about each row

| Rows | The draft |
|---|---|
| 2–6, 8, 10 | not made |
| 7 | one streamed call at low reasoning, with a short answer (title, beats, call to action) |
| 9 | a take a sentence, started as each sentence arrives (four at once for a hosted voice; one after another for the local engine) |
| 12–13, 15 | no call: the storyboard is made by rule and goes through the same tooling and checks |
| 12 | one optional call beside the rule-made plan (the cast, the acting, the card words), with a 12 s deadline |
| 14 | every request at once, 8 s each, a late one drawn instead |
| 16–18 | not run: the run stops at the plan |

## Measured

One prompt, `"A 30-second explainer on why sourdough bread needs a starter"`,
on an Apple-silicon Mac, 10 November 2026. Model `gpt-5.6-luna` (the draft
at low reasoning, the ordinary run at medium), the local Kokoro voice, no
asset provider. Three runs that call the model, as the budget allowed: the
draft, the ordinary run (stopped once its storyboard was written), and a
refine of the draft.

| Seconds from the start to | Ordinary run | `--speed draft`, as first measured |
|---|---|---|
| the first sentence of the script | (not streamed) | 9.5 |
| the script | between 205 and 240 (not timed apart from the voice) | 11.2 |
| the voice | 240.4 | 43.1 |
| a playable plan | 392.2 | **50.9** |
| model calls | 11 | 2 |
| model cost | not totalled (stopped) | $0.003 |

The draft's 28.9 s narration was planned in 51.5 s of wall time: under a
minute, and 7.6 times sooner than the ordinary run's plan.

Where the draft's 50.9 s went: the script call 11.2 s (9.5 s of it before
the first sentence: the model's own thinking), the voice 31.9 s, the
direction call and the plan 7.7 s.

### The voice, fixed after that run

31.9 s for the voice was a fault of the first version, found from this run:
eight sentence takes were queued on the local engine's one slot, and a take
waiting on that slot polls for it. Kokoro itself voices this narration in
7.9 s as one take and 8.7 s as eight. The sentence takes of a local voice
now run one after another inside the run. Measured again on the same
project with the script reused and the direction call off, so no model was
called:

| Step | Before | After |
|---|---|---|
| The voice (8 sentence takes, levelled, joined) | 31.9 s | 9.1 s |
| The rule-made plan and its checks | 0.1 s | 0.1 s |

Put together from parts measured apart, not from one run: 11.2 s (script)
+ 9.1 s (voice) + 7.7 s (direction and plan) is about 28 s, and about 20 s
with `LAUNCHCLIP_DRAFT_DIRECTION_MS=0`. The three runs were spent before the
fix, so no end-to-end run confirms that figure yet.

### The refine

`--refine` on the draft project reused the script and the voice (the
prepare stage took 0.0 s) and planned the ordinary way: one direction call,
the storyboard and four repairs, 290 s. On this run the model's storyboard
still failed its checks after the last repair (acting cues the kit does not
have, two characters swapping sides), so the stage failed and
`storyboard.json` stayed the draft's. That is the ordinary planner on this
script, the same calls an ordinary run makes at row 12 to 15; the ordinary
run above passed on its third repair. A host should expect a refine to take
minutes and to fail sometimes, and keep showing the draft when it does.

## Was under a minute reached, and what stands before 30 seconds

Under a minute: yes, 50.9 s end to end, measured, with the slow voice
included.

Under 30 seconds is not shown by a full run. What stands in the way, in
order of size:

1. **The model's time to the first word, 9.5 s.** At low reasoning this
   model still thinks for about 800 tokens before it writes. A smaller or
   non-reasoning model for the draft (`--draft-model`) is the largest lever
   left, and it is untested here.
2. **The direction call, 7.5 s,** which cannot start until the voice has
   word timings, because the scenes are cut on them. Planning the lines on
   estimated timings while the voice is made would let it overlap the
   voice. `LAUNCHCLIP_DRAFT_DIRECTION_MS=0` drops it today, at the price of
   the default cast.
3. **The voice, 9 s locally.** A hosted voice answered in about 4 s for the
   whole narration in production, and sentence takes overlap there; that
   path is covered by tests on recorded answers and not by a real run here.
4. **Shot lookups** were not in these runs (no provider). They are bounded
   by `LAUNCHCLIP_DRAFT_SHOT_MS` (8 s), all at once, beside the direction
   call.

Nothing was rendered in any of this: the plan is playable in a story
player, and the render is the export's.
