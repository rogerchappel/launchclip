# RFC: `make` at parity with the create-video skill

## Why

The create-video skill and `launchclip make` should produce the same quality
of video from the same brief. Today they do not. A 5-minute `make` news
explainer came out as about 85% centred text cards over one backdrop, with a
hedging, padded script; the same kind of video made through the skill, with an
agent as director, reads and looks far better.

The difference is not mainly the model. It is what the model is allowed to
decide. In the skill the agent is the director and the critic. In long-form
`make` the model writes words and rules decide everything else.

## Where the paths differ

| Skill step | Short `make` | Long `make` |
| --- | --- | --- |
| 1. Brief and evidence: sources read, claims frozen in `EVIDENCE.md` | research notes from a web search | the same; aggregator posts end up as the cited source |
| 2. Concept and story: skeleton, five concepts judged in a fresh context, an edited story, then the script | one script pass | an outline, then one call per chapter |
| 3. Voice: the script resized to the measured take | one resize pass | one resize pass per chapter, which pads short chapters with filler |
| 4. Direction map, then storyboard: the model picks a treatment per line, then a catalogue module per scene | **the model writes both**, with repair passes | **rules pick every module** (`directLongForm`); the model only rewrites card words (`long_form_copy.js`) |
| 5. Candidates for the opening and one risky transition, scored from pixels | none | none |
| 6. Draft render with gates | same | same |
| 7. Fresh-context critic, then repair of the smallest responsible scene, up to three passes | critic only; its verdict is recorded, nothing repairs | the same |
| 8. Gate: `needs-repair` after three passes is reported, not delivered | the verdict is advisory | the same |

The beat director's fallback (`decide` in `kit/core/beat-director.mjs`) is
where the text comes from: a clause with no number, date, list or capture gets
its own line as a `motion-title`, `kinetic-words` or `concept-card`, or holds
the card already on screen. Hedged prose has few facts, so nearly every line
falls through to typography.

## The plan

Each phase is one or two small PRs, measured against the skill on the same
briefs (see "Measuring parity").

1. **Model-directed long form.** Each ≤ 180 s chunk goes through the same
   direction-map-then-storyboard planner short `make` uses, with the chunk's
   narration words, notes, the module catalogue and the visual history so far.
   The beat director stays as the validator and fallback: cadence gate, cut
   spacing, plates, camera, and its rule-made states for any chunk the model
   cannot make pass after its repairs. The copy pass goes away for model-planned
   chunks.
2. **Critic, then repair.** The critic's findings name scenes; a repair pass
   re-plans those scenes only (storyboard planner, same chunk context), the
   affected scenes re-render, and the critic runs again, at most three passes.
   After three, the result is `needs-repair` and an app must not present it
   as finished.
3. **Concept and story.** Before the script: an angle, five concepts judged in
   a fresh context, the chosen story edited for retention, then the script.
   Long form keeps its chapters, but the outline comes from the story.
4. **Length is a ceiling.** A chapter shorter than its slot is not padded; the
   video runs shorter, or the outline gives the time to the chapter with more
   material. No resize pass that adds words.
5. **Primary sources and captures.** Research prefers the source of a claim
   (the company's announcement, docs or pricing page) over aggregator posts,
   drops a story with no primary source, and never names an aggregator in the
   narration. The pages used are captured, so the director can show them
   (`excerpt-window`, `media-window`, `evidence-clip`), and the companies'
   logos join the inventory (`logo-row`, `brand-lockup`).
6. **Candidates.** The opening and one risky boundary render as candidates
   from the pixels, as the skill does, before the draft.

The model matters most in phases 1 to 3. `make` already takes an Anthropic
key; a stronger model there is a configuration choice, not a code change.

## Measuring parity

A fixed set of briefs (a news roundup, a product explainer, a research topic;
one short and one long each) runs through both paths. Per video, from the
storyboard and the critic sheets:

- module variety (distinct modules per minute) and the share of typography
  modules (`motion-title`, `kinetic-words`, `concept-card`, `glass-word`,
  `icon-row`, `object-card`);
- cuts and visual events per minute against the cadence profile;
- held or repeated cards in a row;
- the critic's verdict and blocking findings;
- script checks: hedging phrases, meta-narration ("one of four stories"),
  repeated facts.

`make` is at parity when every metric is within 15% of the skill's on the same
brief, and its typography share is at most 30% for a news or research video.

## Non-goals

- Changing the skill. It is the reference.
- Removing the beat director. It remains the deterministic validator and the
  fallback that keeps a video from failing.
