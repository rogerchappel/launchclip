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

1. **Model-directed long form** (landed). The beat director keeps the clock: clauses,
   shots, plates, camera and the cadence gate. One model call per ≤ 180 s
   chunk then picks every clause's card, as the skill's director does: any
   catalogue module and its params, or a hold on the card before. The
   director's rule-made card stays as the per-clause fallback, for a choice
   the module rejects or that names a file the video does not have. Directed
   chunks need no copy pass; `--long-form-visuals rules` keeps the old path.
2. **Critic, then repair.** The critic's findings name scenes; a repair pass
   re-plans those scenes only (storyboard planner, same chunk context), the
   affected scenes re-render, and the critic runs again, at most three passes.
   After three, the result is `needs-repair` and an app must not present it
   as finished.
   *Landed:* three rounds by default (`--critic-repairs`); long form
   re-directs the chunks that hold the named scenes; `launchclip make` exits 2
   for a `needs-repair` video (`--allow-needs-repair` exits 0).
3. **Concept and story.** Before the script: an angle, five concepts judged in
   a fresh context, the chosen story edited for retention, then the script.
   Long form keeps its chapters, but the outline comes from the story.
   *Landed:* `make` runs the concept tournament and the retention story that
   `produce` already had (`src/make/concept_story.js`), writes `CONCEPTS.json`
   and `STORY.json`, and writes the script on the story. A long video's story
   is a spine of at most three minutes; the outline is derived from its
   beats. `--concepts off` keeps the one-pass script. The skill also writes
   `ANGLE.json` before its concepts; `make` still finds the angle in the
   script pass.
4. **Length is a ceiling.** A chapter shorter than its slot is not padded; the
   video runs shorter, or the outline gives the time to the chapter with more
   material. No resize pass that adds words.
   *Landed:* the resize pass only trims a take that runs over; a short take
   or chapter is kept. Tooling no longer stretches an outline to the
   duration, a short chapter's spare seconds go to the later chapters with
   the most facts, and every script and chapter prompt states the ceiling.
5. **Primary sources and captures** (landed, opt-in with `--research on`). Research prefers the source of a claim
   (the company's announcement, docs or pricing page) over aggregator posts,
   drops a story with no primary source, and never names an aggregator in the
   narration. The pages used are captured, so the director can show them
   (`excerpt-window`, `media-window`, `evidence-clip`), and the companies'
   logos join the inventory (`logo-row`, `brand-lockup`).
6. **Candidates.** The opening and one risky boundary render as candidates
   from the pixels, as the skill does, before the draft.

The model matters most in phases 1 to 3. `make` already takes an Anthropic
key; a stronger model there is a configuration choice, not a code change.

The critic needs a model that can see. The Anthropic adapter used to send
text only, so a run with only `ANTHROPIC_API_KEY` never ran the critic and
ended `ready-for-review`. *Landed:* the adapter sends the contact sheets as
image blocks, so the critic and its repair rounds run by default there too.

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

### The harness

`npm run eval:make-parity -- <make-project> <skill-project> --kind news`
(`eval/make-parity.mjs`) computes these from two finished projects and
prints the comparison. It reads each project's `storyboard.json`,
`NARRATION.json` (or `SCRIPT.json`, or `SCRIPT.md`) and `qa/critic.json`,
so it runs offline and renders nothing.

- A metric passes when it is within 15% of the skill's, or on the better side
  of it: fewer hedges than the skill is not a miss.
- Both videos are judged against one cadence profile (`--format`, else the
  one the make video's length and shape imply).
- A held card is a base scene on screen longer than the profile's longest
  static run with no state of its own. A repeated card has the module and
  the words of the card before it.
- Script rates are per 100 words, so a short and a long script compare. A
  repeated fact is a figure stated in more than one sentence, or a sentence
  that says what an earlier one said.
- `--kind news` or `--kind research` adds the 30% typography ceiling.
- A project with no critique or no script leaves those rows `n/a`; they do
  not count for or against parity.
- `--json` prints both projects' metrics; `--strict` exits 1 when make is
  not at parity. With one project it prints that project's metrics.

With no arguments it runs on the fixture pair in
`eval/fixtures/make-parity`. The fixed set of real briefs is not in the repo
yet: each needs a keyed run through both paths.

## Non-goals

- Changing the skill. It is the reference.
- Removing the beat director. It remains the deterministic validator and the
  fallback that keeps a video from failing.
