# The skeleton library: structures that make a short video worth watching

<!-- Generated from kit/core/skeleton-library.mjs by scripts/sync-skills.mjs. Do not edit by hand; run `npm run skills:sync`. -->

Every short video (90 s or less) meets the same quality rules, and when the brief fits one of the structures below, it is built on that structure too. Nothing is switched on: `launchclip make` picks a library skeleton automatically when the brief fits (`--skeleton <id>` pins one, `--skeleton none` keeps the script format's own) and records it in `SCRIPT.json` and `storyboard.json` (`"skeleton": {"id": "…"}`). `launchclip skeletons list|show|choose` prints the library. The structures are dated practitioner heuristics, not guarantees.

## The short-video rules (every video of 90 s or less)

- **Open on an image.** The scene at 0 s shows the hook's subject (a photo, object, chart, character or product scene), never a title card (`hook-title`, `motion-title`, `kinetic-words`, `section-card`, `masthead`, `glass-word`, `emphasis-caption`). A recording that opens the video counts as the image.
- **A share line.** One spoken line in the last 40% that gives a viewer a reason to send the video or comment: a surprise, a line they recognise themselves in, one small act, a grounded claim to argue with, or a takeaway worth saving. Give it the `share` role in `STORY.json`.
- **Concrete visuals.** Every beat's `visual_noun` names a thing the viewer can picture, never a bare abstraction ("the gap", "growth").
- **5 title options, scored and best first.** Score each 0-10 on curiosity (a gap that carries self-interest, never a tease), clarity (what the video is, at a glance) and match (it fits the opening image and the hook); order by 0.4 × curiosity + 0.35 × clarity + 0.25 × match, minus 3 for over 70 characters or a tease. `make` records them as `title_scores` in `SCRIPT.json`.
- **The cover is a thumbnail, not the opening.** Set `story.cover` `{text, number?, kicker?, frame}` with `frame` at the seconds of the strongest image (the key shot), never `"first"`, which would open the video on a text card. `cover.text` echoes the best title; on a library skeleton, build it on the skeleton's cover idea. finish renders it as `video/cover.png`.

`launchclip finish` checks these in its `structure` gate (and the key shot, on a library skeleton); `launchclip cinematic-check` reads the same gate.

## Using the library on the agent path

1. **Skeleton.** Run `launchclip skeletons choose "<brief>" --medium motion|character|footage|demo --aspect 9:16 --duration 30`, or read the table below. Never use a **blocked** skeleton: the kit cannot draw its key shot, so the video would promise a moment it never shows. No match is fine: use the script format's own skeleton and the short-video rules.
2. **Angle.** Before the concepts, write `ANGLE.json`: `crowded` (how this topic is usually done, one sentence), `inventory` (eight to twelve concrete things only this subject has), `angles` (three fresh angles, each `{angle, differs}`) and `chosen` (the index the story is written on). Spread the five concepts across the angles. `make` writes the same file from its script pass.
3. **Judge** in a fresh context (a subagent that sees only the brief, evidence, the skeleton and the anonymous concepts), and score `angle_freshness` and `share_strength` with the other criteria.
4. **Story.** Write `STORY.json` on the skeleton's beats, roles included.
5. **Storyboard.** Put `"skeleton": {"id": "<id>", "version": "<month>"}` in `storyboard.json`; render the key shot inside its beat.
6. **Voice.** A `human-or-premium` skeleton drafts with the free voice and says so in review: the final needs the user's own recording or an explicit premium opt-in.

## Skeletons

| Skeleton | Family | Media | Aspects | Length | Share | Voice | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dollar-a-second` $1 a second | scale | motion | 9:16 | 20–45 s | surprise | free | ready |
| `if-it-were` If it were… | if-were | motion | 9:16 | 20–50 s | surprise | free | ready |
| `versus` X vs Y | versus | motion, demo | 9:16, 1:1 | 20–60 s | debate | free | ready |
| `nobody-tells` What nobody tells you | nobody-tells | motion, footage | 9:16 | 20–60 s | useful | free | ready |
| `countdown` Countdown to number one | countdown | motion | 9:16 | 25–60 s | useful | free | ready |
| `myth-check` Myth check | myth | motion, footage | 9:16 | 20–60 s | surprise | free | ready |
| `last-time` The last time | last-time | character | 9:16 | 20–45 s | act | human-or-premium | blocked: needs pose lift |
| `pov` POV | pov | character | 9:16 | 15–40 s | identity | better | ready |
| `before-after` Before and after | before-after | demo, footage, motion | 9:16, 1:1, 16:9 | 15–60 s | useful | free | ready |
| `how-its-made` How it is made | process | footage, motion | 9:16 | 20–60 s | useful | free | ready |

### `dollar-a-second`: $1 a second

- **Hook:** Second person, a personal stake in one number, and a question the viewer will answer wrong. Template: "I'll {give} you {unit} every {interval}. When {milestone}?"
- **Beats:** Stake (hook, ~14%): A personal stake in one number, as a question. → First milestone (proof, ~16%): The first milestone lands, smaller than the viewer guessed. → Keep going (rehook, ~10%): Push on to the next order of magnitude: "now keep going". → Second milestone (escalation, ~20%): The second milestone, far bigger than expected, as a concrete span of life. → Third milestone (escalation, ~18%): The third, absurd; compared with something the viewer already knows. → The gap (share, ~14%): The gap in one line the viewer will repeat at dinner. → Loop (cta_or_loop, ~8%): The last line runs back into the hook, so the video loops.
- **Key shot:** a clock or calendar racing while the stake grows beside it (`count-up`, `odometer`, `flip-clock`, `slot-roll`, `number-line`, `timeline`)
- **Opening image:** the stake as an object (a coin, a note, a counter at $1), never a title card (`count-up`, `odometer`, `flip-clock`, `stat-card`, `object-card`, `photo-scene`)
- **Share (surprise):** A comparison the viewer can repeat ("twelve days and thirty-two years apart").
- **Avoid:** a title card as the hook; a bar chart without a picturable unit; a source line held over scenes it does not cite
- **Voice:** free, quick, amused, conversational. **Sound:** normal density, long cues rare.
- **Titles:** "{unit} a second: how long until {milestone}?", "{a} vs {b} is not what you think", "How long is {milestone}, really?". **Cover:** the two milestones side by side, the gap as the headline.
- **Notes:** Works for any scale gap. Weak when the numbers are already famous: find a fresher unit than seconds.

### `if-it-were`: If it were…

- **Hook:** Rescale something huge into something the viewer lives in (a day, a football pitch, a year). Template: "If {big thing} were {familiar span}, {surprising fact}."
- **Beats:** Rescale (hook, ~14%): The rescale and its most surprising consequence, in one line. → The frame (promise, ~12%): Set the familiar span on screen: where it starts and ends. → Landmarks (proof, ~26%): Two or three landmarks placed on the span, each later than the viewer expects. → The squeeze (escalation, ~18%): Everything the viewer knows crammed into the last sliver. → Reframe (share, ~20%): What that makes us, in one line worth repeating. → Loop (cta_or_loop, ~10%): The last line runs back into the hook, so the video loops.
- **Key shot:** the familiar span (a clock, a ruler, a pitch) with the landmarks squeezed into its last sliver (`timeline`, `number-line`, `countdown`, `progress-ring`, `percent-fill`)
- **Opening image:** the familiar span itself (a clock face, a calendar), never a title card (`timeline`, `countdown`, `progress-ring`, `number-line`, `photo-scene`, `object-card`)
- **Share (surprise):** A reframe the viewer can repeat ("all of history fits in the last seconds before midnight").
- **Avoid:** a title card as the hook; a wall of dates; numbers without the span on screen
- **Voice:** free, calm wonder, unhurried. **Sound:** normal density, long cues rare.
- **Titles:** "If {big thing} were {familiar span}", "{big thing}, squeezed into {familiar span}". **Cover:** the span with one tiny marked sliver.
- **Notes:** The span must be one the viewer feels (a day, a year), not another big number.

### `versus`: X vs Y

- **Hook:** Name both sides and the stake in the first line. Template: "{X} or {Y}? {the thing everyone gets wrong}."
- **Beats:** The match-up (hook, ~14%): Both sides and the stake. → Round one (proof, ~20%): The first comparison, side by side, on one concrete measure. → Round two (escalation, ~20%): A second measure that cuts the other way. → Verdict (payoff, ~20%): Which one, for whom, from the evidence. → The argument (share, ~16%): The line people will argue with, grounded in the evidence. → Close (cta_or_loop, ~10%): One action, or a loop back to the match-up.
- **Key shot:** a split frame that resolves to one side (`compare`, `comparison-table`, `flow-compare`, `gauge-compare`, `bar-chart`)
- **Opening image:** both sides on screen at once, never a title card (`compare`, `comparison-table`, `gauge-compare`, `photo-scene`, `device-frame`)
- **Share (debate):** A claim people will argue with in the comments, and only one the evidence supports.
- **Avoid:** a title card as the hook; a verdict with no evidence; more than two sides
- **Voice:** free, punchy, a little cheeky. **Sound:** normal density, long cues rare.
- **Titles:** "{X} vs {Y}: {stake}", "Stop choosing {X} for {stake}". **Cover:** the two sides split down the middle, the winner a shade brighter.
- **Notes:** Needs a real measure on each side; a vibe comparison reads as an opinion piece.

### `nobody-tells`: What nobody tells you

- **Hook:** Name the thing the viewer already does and promise the part they have not been told. Template: "Nobody tells you {the hidden cost} of {the thing}."
- **Beats:** The promise (hook, ~14%): The thing and the hidden part. → What you know (promise, ~14%): The version everyone hears, in one line. → What is under it (proof, ~28%): The hidden cost, with one concrete example from the brief. → What to do (payoff, ~20%): One thing the viewer can do about it. → Takeaway (share, ~14%): The takeaway worth saving, in one line. → Close (cta_or_loop, ~10%): One action, or a loop.
- **Key shot:** the hidden cost revealed underneath the known one (`stacked-bar`, `waterfall`, `object-card`, `excerpt`, `torn-paper`, `callout-arrow`)
- **Opening image:** the familiar thing itself (the receipt, the contract, the habit), never a title card (`object-card`, `photo-scene`, `excerpt`, `device-frame`, `polaroid`)
- **Share (useful):** A takeaway the viewer will save or send to someone about to do the thing.
- **Avoid:** a title card as the hook; a list of five tips; fear without a fix
- **Voice:** free, frank, a friend letting you in on it. **Sound:** low density, long cues rare.
- **Titles:** "What nobody tells you about {the thing}", "The hidden cost of {the thing}". **Cover:** the familiar thing with its hidden part torn open.
- **Notes:** The hidden part must come from the brief or evidence; never invent one.

### `countdown`: Countdown to number one

- **Hook:** Tease number one in the hook; it pays off last. Template: "The {n} {things}, and number one {surprising claim}."
- **Beats:** The tease (hook, ~12%): The list and a tease of number one. → The lower ranks (proof, ~30%): The lower entries, quickly, each with one concrete detail. → Before number one (rehook, ~10%): A turn before the top: "but number one…". → Number one (payoff, ~24%): Number one, held, with its proof. → Why it matters (share, ~14%): The takeaway worth saving. → Loop (cta_or_loop, ~10%): The last line runs back into the hook, so the video loops.
- **Key shot:** number one revealed last, bigger than the rest (`leaderboard`, `countdown`, `icon-grid`, `stat-card`, `object-card`)
- **Opening image:** the list in motion, number one hidden, never a title card (`leaderboard`, `icon-grid`, `countdown`, `object-card`, `photo-scene`)
- **Share (useful):** A takeaway worth saving; the ranking itself is worth sending.
- **Avoid:** a title card as the hook; numbered slides of equal weight; number one revealed early
- **Voice:** free, brisk, building to the top. **Sound:** normal density, long cues rare.
- **Titles:** "The {n} {things}, ranked", "Number one surprised me". **Cover:** the list with number one blurred or hidden.
- **Notes:** Keep it to three to five entries in a Short; every entry needs one concrete detail.

### `myth-check`: Myth check

- **Hook:** State the belief the viewer holds, then signal it is about to fall. Template: "You were told {myth}. {it is wrong / it is worse}."
- **Beats:** The myth (hook, ~14%): The belief, stated as the viewer would. → Why we believe it (promise, ~14%): Where it comes from, in one line. → The test (proof, ~28%): The evidence that overturns it, from the brief. → What is true (payoff, ~20%): The real answer, plainly. → The reframe (share, ~14%): The line the viewer will use to correct someone. → Loop (cta_or_loop, ~10%): The last line runs back into the hook, so the video loops.
- **Key shot:** the myth stamped on screen, then overturned (`concept-card`, `object-card`, `sticker`, `badge`, `stat-card`, `excerpt`)
- **Opening image:** the myth as a thing (the advice, the headline, the habit), never a title card (`excerpt`, `object-card`, `photo-scene`, `quote-card`, `feed-frame`)
- **Share (surprise):** A reframe the viewer can use to correct someone, with its source.
- **Avoid:** a title card as the hook; a "myth vs fact" table; a debunk without a source
- **Voice:** free, confident, a little playful. **Sound:** normal density, long cues rare.
- **Titles:** "{myth}? Not quite", "You were told {myth}". **Cover:** the myth with a stamp across it.
- **Notes:** The overturning evidence must be in EVIDENCE.md or the brief.

### `last-time`: The last time

- **Hook:** One ordinary, universal moment, and the realisation that it ended without anyone noticing. Template: "There was a last time {ordinary moment}. Neither of you knew it."
- **Beats:** The moment (hook, ~16%): The ordinary moment, and that it was the last. → Then (proof, ~22%): Two more ordinary lasts, each a concrete picture. → The jump (escalation, ~20%): Years pass in a cut: the roles turn around. → Now (payoff, ~16%): The other person, now, still holding on to it. → The call (share, ~16%): The one thing to do today. → Close (closing_reframe, ~10%): A quiet line that lands the feeling.
- **Key shot:** the parent lifting the child, the moment the title promises (`cast-scene`; needs poses lift)
- **Opening image:** the two characters in the ordinary moment, faces readable, never a title card (`cast-scene`, `character-cameo`, `photo-scene`)
- **Share (act):** One small act the viewer can do today ("so call him").
- **Avoid:** a title card as the hook; captions across the characters; figures too small to read their faces
- **Voice:** human-or-premium, warm, slow, close to the microphone. **Sound:** low density, long cues rare.
- **Titles:** "The last time {ordinary moment}", "Nobody tells you when it is the last time". **Cover:** the two characters in the moment, warm light, one word of text.
- **Notes:** Blocked until the rig can lift a child; without the lift the hook promises a moment the video never shows.

### `pov`: POV

- **Hook:** The viewer's own situation, specific enough that they feel seen. Template: "POV: {the viewer's exact situation}."
- **Beats:** The situation (hook, ~16%): The viewer's exact situation. → It gets worse (proof, ~30%): Two or three beats of the situation getting more familiar. → The turn (payoff, ~20%): The twist or the small win. → Recognition (share, ~20%): The line they will send to the friend who does this. → Loop (cta_or_loop, ~14%): The last line runs back into the hook, so the video loops.
- **Key shot:** the character caught in the viewer's situation, their face doing the work (`cast-scene`; needs actions look-far)
- **Opening image:** the character mid-situation, never a title card (`cast-scene`, `character-cameo`)
- **Share (identity):** A line the viewer sends to the friend who does exactly this.
- **Avoid:** a title card as the hook; a narrator explaining the joke
- **Voice:** better, deadpan, close. **Sound:** normal density, long cues rare.
- **Titles:** "POV: {situation}", "Every {person} knows this feeling". **Cover:** the character's face at the worst moment.
- **Notes:** Specific beats general: the more exact the situation, the more it travels.

### `before-after`: Before and after

- **Hook:** Open on the before, in the viewer's own words; the product can wait. Template: "This is {the painful before}. Watch."
- **Beats:** Before (hook, ~18%): The before, concrete and recognisable. → The switch (mechanism, ~18%): The one change, shown, not described. → After (proof, ~26%): The same frame after, with one measured difference from the brief. → The difference (share, ~18%): The difference in one line worth sending. → Call to action (cta_or_loop, ~20%): One action, one destination.
- **Key shot:** the same frame, before and after (`compare`, `product-demo`, `app-stage`, `phone-stage`, `device-frame`, `media-window`)
- **Opening image:** the before, on screen, never a title card or a logo (`product-demo`, `app-stage`, `phone-stage`, `device-frame`, `media-window`, `photo-scene`)
- **Share (useful):** The difference, measured, in one line worth sending to a colleague.
- **Avoid:** a logo as the hook; a feature list; an after with no before
- **Voice:** free, plain, confident. **Sound:** normal density, long cues rare.
- **Titles:** "{task}: before and after {product}", "From {before} to {after}". **Cover:** the before and after split, the after brighter.
- **Notes:** The after must be real: a recording or a fact from the brief.

### `how-its-made`: How it is made

- **Hook:** Lead with the step people never see, not step one. Template: "Every {thing} goes through {the step nobody sees}."
- **Beats:** The unseen step (hook, ~14%): The step nobody sees. → Where it starts (promise, ~14%): The raw start, one concrete picture. → The steps (mechanism, ~30%): Two or three steps, each a visible change to the thing. → The unseen step (payoff, ~18%): The step from the hook, shown at last. → Takeaway (share, ~14%): What the viewer will notice next time they see one. → Loop (cta_or_loop, ~10%): The last line runs back into the hook, so the video loops.
- **Key shot:** the one step people never see, shown in full (`process-steps`, `flow-compare`, `photo-scene`, `footage-callout`, `zoom-through`)
- **Opening image:** the thing mid-process, never a title card (`photo-scene`, `process-steps`, `footage-callout`, `zoom-through`, `object-card`)
- **Share (useful):** Something the viewer will notice next time they see the thing.
- **Avoid:** a title card as the hook; step one first; a diagram with no real object
- **Voice:** free, curious, measured. **Sound:** normal density, long cues rare.
- **Titles:** "How {thing} is really made", "The step nobody sees in {thing}". **Cover:** the unseen step, close up.
- **Notes:** Strongest with real footage; in motion, use object scenes, not diagrams.

## Your own skeletons

Add `<project>/.launchclip/skeletons/<id>.json` or `~/.launchclip/skeletons/<id>.json` with `"schema": "launchclip.skeleton.v1"` and the same fields; a project skeleton overrides a user one, which overrides a built-in one with the same id. `launchclip skeletons show <id>` validates it.
