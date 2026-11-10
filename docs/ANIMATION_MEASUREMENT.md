# Measuring animation

How a finished character Short is measured, and how `launchclip make` is
compared with the create-video skill on the same briefs. This is the
measurement part of phase 8 in [ANIMATION_PIPELINE_RFC.md](ANIMATION_PIPELINE_RFC.md)
(§8.2 and §8.3). It follows [MAKE_SKILL_PARITY.md](MAKE_SKILL_PARITY.md):
a fixed set of briefs through both paths, compared from the files they leave.

**Status.** The scorecard, the dialogue measures, the `script` gate and the
parity table's format exist. The six briefs have not been run on either
path, because the one-prompt animation run is not finished (phases 6 and 7).
[benchmarks/ANIMATION_PARITY.md](../benchmarks/ANIMATION_PARITY.md) says
"not yet run" and holds no numbers.

## The six briefs

They live in `eval/formats.json` under `animation`. Each is a 30–45 second
9:16 Short. `brief` is the prompt both paths are given, word for word.

| Brief | Exercises | Its own checks |
|---|---|---|
| `product-fix`: two characters, a problem and a fix | both characters speak and act; the problem lands in time; a product shown through what a character does | 2 characters; the narrator has at most a third of the lines |
| `pov`: one character caught in the viewer's situation | the `pov` skeleton; one face and body carrying the video; a cast of one through the bible | 1 character; skeleton `pov`; at least 8 pose or expression changes a minute |
| `last-time`: two characters in an ordinary moment | the `last-time` skeleton and its key shot; a quiet register with few lines | 2 characters; skeleton `last-time` |
| `argument`: two characters who disagree, mostly dialogue | dense turns; the speaker on screen; reactions; long holds on one framing; lip sync at speed | 2 characters; at least 12 turns a minute; at most a quarter of the lines silent; the narrator at most 15% |
| `silent`: almost no dialogue, all acting | silent lines in the script; acting per minute; captions and the mix with little speech | 2 characters; at least half the lines silent; at most 3 spoken lines; at least 8 pose or expression changes a minute |
| `trio`: three characters, one of whom barely speaks | three voices and three designs; staging three people in 9:16; a quiet character staying present | 3 characters; the quietest has at most 15% of the spoken lines |

## Running the scorecard

The scorecard reads finished projects. It renders nothing and calls no model.

```bash
# One finished project per brief, in <runs>/<brief id>/
npm run eval:formats -- --animation --path make --runs runs/make
npm run eval:formats -- --animation --path skill --runs runs/skill

# One project, for one brief
npm run eval:formats -- --animation --path make --project argument=path/to/project

# No run: the stand-in example for the first brief, to see the report
npm run eval:formats -- --animation
```

`--path` records which route made the projects. The report is written to
`qa/animation-eval/<path>/report.json` and `report.md` (`--out` changes it).
A brief with no project is listed as "not run" and does not fail the command.
`--formats product-fix,pov` runs some of the briefs.

A finished project is a folder with `storyboard.json`. The scorecard also
reads, when they are there: `SCRIPT.json`, `BIBLE.json`, `DIRECTION.json`,
`NARRATION.json`, `MAKE.json`, `qa/finish/gates.json`, `qa/critic.json` and
`qa/retakes.json`. A file that is missing gives a "missing" or "not recorded"
cell, never a guessed value.

With no `--runs` and no `--project`, the first brief is scored from the
hand-authored example `examples/story/dialogue-9x16`. The report marks it as
a stand-in. It is never used when a path is named, and it never reaches the
parity table.

### What it reports

Per project, following RFC §8.3:

- **Contracts.** The script (the `script` gate), the show bible (the `bible`
  gate), the direction map and the storyboard (`launchclip story validate`):
  valid, invalid or missing, and the repair passes `MAKE.json` records.
- **Story.** Characters, spoken and silent lines, lines per character, the
  narrator's share, and when the problem lands.
- **Design.** Characters in the bible, and whether each one's `must_keep`
  list differs from the others'.
- **Direction.** Shots, key actions per minute, distinct poses and
  expressions, the framings used, and the share of lines played on a reaction.
- **Cadence.** Every measure in the story's profile, each against its band.
- **Gates.** What `finish` recorded in `qa/finish/gates.json`.
- **Critic.** The verdict, blocking and major findings, and retake rounds.
- **Cost.** The model cost and wall-clock time in `MAKE.json`.

Two limits to know:

- `qa/finish/gates.json` is the last `finish`. It is "the first render" the
  RFC asks for only if no retake has run since. Nothing records the first
  render separately yet.
- A skill run has no `MAKE.json`, so its cost, time and repair passes are
  not recorded. Those rows are "unmeasured" in the parity table.

## The parity table

```bash
npm run eval:animation-parity
```

It reads `qa/animation-eval/make/report.json` and
`qa/animation-eval/skill/report.json` (`--make`, `--skill` name other files)
and writes `benchmarks/ANIMATION_PARITY.md` (`--out`). `--strict` exits 1
unless all six briefs are at parity.

On one brief, `make` is at parity when:

- every numeric metric is within 15% of the skill's. For counts of things
  going wrong (repair passes, blocking findings, retake rounds), fewer than
  the skill's is not a miss;
- the same gates pass on both;
- the critic's verdict is no worse than the skill's.

Cost and wall-clock time are shown and do not decide parity: the skill's are
not recorded, and an agent's time is not comparable with a headless run's.
This is narrower than the RFC's "every numeric metric".

A metric either path could not measure is "unmeasured". With the gates or
the critic unmeasured, a brief is "incomplete", not at parity. A brief either
path has not finished is "not run", and its cells stay empty.

### Once both paths can run

```bash
npm run eval:formats -- --animation --commands --runs runs/make
```

prints the six `launchclip make "<brief>" --animation --aspect 9:16 --out
runs/make/<id>` commands. Run them, then give an agent the create-video
skill and each `brief` from `eval/formats.json`, writing to
`runs/skill/<id>`. Then:

```bash
npm run eval:formats -- --animation --path make --runs runs/make && npm run eval:formats -- --animation --path skill --runs runs/skill && npm run eval:animation-parity
```

Run the scorecard after the first `finish` and before any retake if you want
the gates as they stood on the first render.

## The dialogue measures

`characterMeasures(shots, {duration, words, script})` in
`kit/core/cadence.mjs` reads the shot list (`launchclip story shots --json`),
the voiced words and the script. For a LaunchClip project the values are
exact: the files say who speaks, who is drawn and when a pose changes.

| Measure | What it is | Band check |
|---|---|---|
| `speaker_turns_per_min` | changes of speaker per minute; the narrator is a speaker | both sides |
| `line_seconds` | length of a spoken line (the median is compared) | both sides |
| `reaction_share` | of the time a character speaks, the share where a listener in the shot changes pose or expression during the line, or the speaker is unseen and a listener holds the shot | floor only |
| `longest_framing_seconds` | the longest stretch on one set, one shot size and one group of people; a cut that changes none of them does not end it | ceiling only |

A line is one written script line when the script's spoken lines add up to
the take's words. Otherwise it is one speaker's unbroken run, split at
pauses of 0.6 s.

The same function computes `scene_seconds`, `character_screen_time`,
`expression_changes_per_min` and `problem_lands_seconds`, which the
`story-characters` profile already carried and nothing computed.

They are reported by the scorecard. The `coverage` gate in `finish` does not
read them yet.

### What is provisional

`story-characters` is still a seed profile: `"references": 0`. No reference
video was measured for this work.

- The four dialogue bands (turns 4–30 a minute, target 12; lines 0.8–5 s,
  target 2.2; reaction share at least 10%; one framing at most 12 s) were
  set by hand from the script contract's arithmetic: 150 words a minute and
  0.3 s between lines. `kit/profiles/PROVENANCE.md` says so by name.
- The older bands in the profile are the seed values they were before.
- `launchclip profile measure` reads pixels. It cannot hear who speaks, so
  it cannot produce the dialogue measures from a reference video. Replacing
  these bands needs references annotated by hand, or our own approved
  renders measured from their project files.
- The 9:16 Shorts variant of the profile (RFC §8.2) is not built.

One thing the stand-in shows: the hand-authored dialogue example reads above
two of the older seed bands (`character_screen_time` 0.99 against a ceiling
of 0.95, and `expression_changes_per_min` 23 against 20). Those ceilings
were set before anything computed the measures. They are left as they were
until references are measured.

## The `script` gate

`scriptGate({project, resolved, words, profile})` in `src/script_gate.js`
holds a project's `SCRIPT.json` to the screenplay contract
(`validateScreenplay`). It fails when:

- a speaker is not in `characters` (`speaker-unknown`);
- a listed character never speaks and no silent line's action names them
  (`character-unused`);
- the script runs more than 15% over its length (`fits-length`);
- the problem beat starts after the profile's `problem_lands_seconds` p90,
  or there is no problem beat (`problem-lands`, `problem-missing`);
- anything else breaks the contract (a line with no id, a silent line with
  no length, `narration` that is not the lines).

The length is `duration` in the script, else `plan.duration`, else the
story's own. The pace is `plan.wpm`, else the pace measured from the take
(`NARRATION.json`), else 150 words a minute. A project with no `SCRIPT.json`,
or a narrated version 1 script, is skipped. The gate reads only the project
and calls no model. It does not run the copy checks of `launchclip script
check`, which need the brief.

`finish` does not call it yet. The scorecard does, and reports it as the
script contract. Registering it in `finish` is two lines beside the `bible`
gate:

```js
const script = await scriptGate({ project: ctx.project, resolved: ctx.resolved, words: ctx.words, profile });
if (script.status !== "skipped") gates.script = script;
```

`eval/fixtures/animation/broken-script` fails all four named rules;
`examples/story/dialogue-9x16` passes.
