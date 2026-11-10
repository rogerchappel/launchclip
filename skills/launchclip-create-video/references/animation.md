<!-- Generated from src/animation_paths.js by scripts/sync-skills.mjs; edit the code, not this file. -->

# Animation: a character story from one prompt

Use this branch when the brief is a story told by characters: named people who
talk to each other, a scene acted out, "an animated short about…", a skit, a
fable, a two-hander. A narrated explainer in which a character appears for a
beat is not this branch: it is the ordinary quick path with a `cast-scene` or
a `character-cameo`.

You play four roles in turn (`writer`, `designer`, `director`, `critic`) and LaunchClip draws
everything in code. Nothing here generates an image or a video, and every
command in this file is local tooling with no model call. Three flags do pay
for a model and are never part of this path unless the user asks for them:
`finish --review`, `finish --retake` and `cast create --model`.

The order is fixed, and two points stop for the user:

1. Model check
2. Script: `SCRIPT.json`
3. Show bible: `BIBLE.json` and the reference sheets. **Stop: the user approves the cast.**
4. Voice: `NARRATION.json`
5. Shot list: `DIRECTION.json`, then `storyboard.json`
6. Animatic: `ANIMATIC.json` and your staging review. **Stop: the user approves the animatic.**
7. Draft, critic and retakes: `qa/critic.json`, `qa/retakes.json`

## The contract files

`launchclip make "<prompt>" --animation` is the same pipeline with an API
model in your seat. Both routes write these files in these schemas and check
each with the same command, so a project started on one route can be finished
on the other.

| File | Schema | Written by | Checked with | `make` stage |
|---|---|---|---|---|
| `SCRIPT.json` | `launchclip.make-script.v2` | you, as the writer | `launchclip script check <project> --duration <seconds> --brief <project>/BRIEF.md` | `prepare` |
| `BIBLE.json` | `launchclip.show-bible.v1` | you, as the designer (`launchclip bible freeze <project>`) | `launchclip bible show <project>` | `bible` |
| `NARRATION.json` | `launchclip.narration.v1` | tooling (`launchclip voice <project>`) | `launchclip voice <project>` | `bible` |
| `DIRECTION.json` | `launchclip.direction-map.v1` | you, as the director | `launchclip story validate <project>/storyboard.json` | `storyboard` |
| `storyboard.json` | `launchclip.story.v1` | you, as the director | `launchclip story validate <project>/storyboard.json` | `storyboard` |
| `ANIMATIC.json` | `launchclip.animatic.v1` | tooling (`launchclip finish <project> --animatic`) | `launchclip finish <project> --animatic` | `animatic` |
| `qa/animatic-critic.json` | the critic format | you, as the critic | the review that reads it | `animatic` |
| `qa/critic.json` | the critic format | you, as the critic | `launchclip cinematic-check <project> --video renders/draft.mp4 --critique qa/critic.json --expect-audio` | `critic` |
| `qa/retakes.json` | `launchclip.retakes.v1` | you, as the critic | the review that reads it | `critic` |

Write the files into the output project from the quick path's step 1
(`.launchclip/agent-<slug>`), which already holds `BRIEF.md`,
`EVIDENCE.md` and `SOURCE.md`. Default delivery is a 9:16 Short of 20 to 40
seconds with two characters and a narrator.

## 1. Model check

```bash
launchclip doctor --models --agent --json
```

It reports every role as yours (`"agent"`) and makes no paid call. If you
cannot look at images, say so before you start: the cast approval and both
reviews need someone to look, and the user will have to be the one.

## 2. Script (you are the writer)

Three small steps, as the writers' room in `make` takes them:

1. **Premise.** One sentence each: what the lead wants, what is in the way,
   what changes.
2. **Loglines.** Write three to five one-sentence versions of the story. Have
   them judged in a fresh context (a subagent given only the brief and the
   loglines) and take the winner.
3. **Script.** Write `SCRIPT.json`:

```json
{
  "schema_version": "launchclip.make-script.v2",
  "title": "Test the rollback",
  "logline": "Pia is about to ship on a Friday; Dov asks the one question she skipped.",
  "premise": { "want": "ship before the weekend", "obstacle": "a rollback nobody has tested", "change": "she tests before she ships" },
  "characters": [
    { "id": "pia", "role": "lead", "want": "to ship and go home", "speech": "short, sure of herself" },
    { "id": "dov", "role": "foil", "want": "a quiet weekend for both of them", "speech": "calm, a little dry" }
  ],
  "beats": [
    { "beat": "setup", "place": "desk-laptop", "lines": [
      { "id": "l1", "speaker": "narrator", "text": "Pia is about to ship on a Friday." } ] },
    { "beat": "problem", "place": "standing", "lines": [
      { "id": "l2", "speaker": "dov", "text": "Did you test the rollback?", "playing": "light, as if in passing" },
      { "id": "l3", "speaker": "pia", "text": "It worked last month.", "playing": "breezy" },
      { "id": "l4", "speaker": null, "action": "Dov says nothing and waits.", "seconds": 1 } ] }
  ],
  "narration": "Pia is about to ship on a Friday. Did you test the rollback? It worked last month.",
  "title_options": ["Test the rollback"]
}
```

- **A narrator with dialogue is the default shape.** The narrator
  (`"speaker": "narrator"`) sets the scene and lands the ending; the
  characters speak the turns. Write pure dialogue only when the brief asks.
- A line is spoken (`speaker` is a character id or `"narrator"`, with
  `text`) or silent (`"speaker": null`, with an `action` and its
  `seconds`). Silent lines are where the acting happens. A silent line, or
  a run of them, is at most 3 seconds, and it goes between two spoken
  lines: one before the first spoken line or after the last is not held.
- `beats[].beat` is one of `setup`, `problem`, `attempt`, `turn`, `resolution`, `cta`, in story order. There
  must be a `problem` beat and it must start early (the check gives the
  limit). `place` is a set: `desk-laptop`, `phone`, `meeting`, `screen`, `kitchen-counter`, `sofa`, `podium`, `stage`, `car`, `park-bench`, `video-call`, `standing-desk`, `standing`.
- `characters` are roles, wants and ways of speaking, not looks. Every listed
  character speaks, or is named in a silent line's `action`. Ids are
  lowercase (`^[a-z][a-z0-9-]{0,23}$`) and become the cast ids.
- `playing` is a note for the acting. It is never spoken.
- `narration` is every spoken line's text joined in order with spaces.
- Keep it short: lines of three to nine words, two characters, two sets. At
  the check's pace of 150 words a minute a 30-second Short holds about 60
  spoken words less its pauses.
- Facts, numbers and claims follow the evidence rules: nothing that is not in
  the brief.

Check it, and fix every error before going on:

```bash
launchclip script check <project> --duration <seconds> --brief <project>/BRIEF.md
```

Also write `SCRIPT.md`, the same lines as a readable screenplay (speaker,
line, the `playing` note in brackets), for the user and for the gate at the
end.

## 3. Show bible (you are the designer)

The bible pins who is in the story, what each looks and sounds like, where it
happens and how it is drawn. It is frozen before any shot is planned, and
nothing later may change it.

**Design the cast, and keep it simple.** One character file per script
character, with the script's id, in the `chibi` style unless the
brief names another (the styles: `flat`, `line`, `outlined`, `paper`, `soft-shade`, `stick`, `stick-classic`, `lifelike`, `cinematic`, `avatar`, `chibi`, `chibi-plain`):

```bash
launchclip cast list                      # the starter characters: their ids are taken
launchclip cast options                   # every option the rig can draw
launchclip cast create pia --project <project> --style chibi --no-sheet \
  --describe "a short woman with a dark bob, round glasses and a teal hoodie" --voice af_heart
launchclip cast create dov --project <project> --style chibi --no-sheet \
  --describe "a tall man with short grey hair, a beard and a mustard cardigan" --voice am_michael
```

- Three or four traits a viewer would notice are enough: hair, one garment
  and its colour, one accessory. Make the two silhouettes and the two top
  colours different, so they read apart at phone size.
- Give every speaking character a different `--voice` (`launchclip cast
  options voice`), and none of them the narrator's.
- `cast create` refuses an id that is a starter's (`"pia" is a starter
  character`). Then either rename the character in `SCRIPT.json` and
  run the script check again, or use the starter as it is by naming it in
  `--characters` below.
- Read `assumed` and `unmatched` in the result and fix what matters with
  `launchclip cast edit <id> --project <project> --set path=value`.
- Describe traits. Never design a real person's likeness, and read a
  reference image for traits only. The launchclip-character-design skill has
  the full loop when the brief calls for a careful design.

**Freeze it.** Choose the world (`launchclip bible freeze --help` lists the
flags), the sets the script's beats use, and a side for each character:

```bash
launchclip bible freeze <project> --world office --time day --sets desk-laptop,standing \
  --position pia=left --position dov=right --rule "Dov never raises his voice."
launchclip bible show <project>
```

`bible freeze` reads the characters saved in the project (or
`--characters pia,dov`, which also takes starters), draws one reference
sheet per character to `bible/sheets/<id>.png`, writes `must_keep` and
the hash, and pins `storyboard.json` and `DIRECTION.json` when they exist.
The sheets are drawn in Chromium: if none is found, install one (`npx
playwright install chromium`) or name one with `--chromium <path>` or
`LAUNCHCLIP_CHROMIUM`. `bible show` must exit 0: it checks the hash, the
sheets and that every script character has an entry and a voice.

**Look at the sheets** (`bible/sheets/<id>.png`): does each character
match its role, do the two read apart, does every expression read? Change a
character with `cast edit`, then freeze again with `--characters <ids>
--force`.

**Stop 1: the cast.** Show the user the sheets, the voices and the logline,
and wait for a yes before planning any shot. This is the cheap place to change
a character. After approval the bible does not change: a new look is a new
bible, and every later step is redone against it.

## 4. Voice

Get the dialogue lines from the script, with each silent line turned into the
pause after the line before it:

```bash
launchclip script check <project> --json     # → narration.lines
```

Write a first `storyboard.json` with no scenes yet, and put those lines in
it unchanged:

```json
{
  "schema": "launchclip.story.v1",
  "title": "Test the rollback",
  "lane": "motion",
  "format": { "width": 1080, "height": 1920, "fps": 30, "duration": 30, "platform": "youtube-shorts" },
  "audio": { "narration": { "provider": "kokoro", "voice": "bf_emma", "lines": [
    { "speaker": "narrator", "text": "Pia is about to ship on a Friday." },
    { "speaker": "dov", "text": "Did you test the rollback?" },
    { "speaker": "pia", "text": "It worked last month.", "gap": 1 } ] } },
  "overlays": [{ "type": "captions", "style": "word-highlight" }],
  "scenes": []
}
```

`audio.narration.voice` is the narrator's voice. Do not write a `cast`:
the bible supplies it. Pin the story to the bible, then voice it:

```bash
launchclip bible freeze <project>     # changes nothing in the bible; writes the story's cast and "bible": {file, hash}
launchclip voice <project>
```

`voice` speaks each line in its speaker's voice (local Kokoro, free,
cached), writes `NARRATION.json` with a speaker on every word, and prints one
row per line with its start, end and first-word anchor. Set
`format.duration` to the measured duration plus 0.5 to 0.8 seconds, and add
`"words": "NARRATION.json"` to `audio`. If the take is too long, cut lines
in `SCRIPT.json` (check it again, copy the new lines across, voice again); never
guess a length from a word count.

## 5. Shot list (you are the director)

There is no shot-list file. A shot is a character scene in
`storyboard.json`, and `DIRECTION.json` says why each one exists. Write the map
first, then the storyboard against it. [direction-map.md](direction-map.md)
("Narrative maps") and [storyboard-modules.md](storyboard-modules.md)
(`cast-scene`, `character-cameo`) hold every field; the rules that matter
here:

**The map.** `"profile": "story-characters"`, one section per story beat, one line
per spoken script line:

```json
{
  "schema": "launchclip.direction-map.v1",
  "profile": "story-characters",
  "sections": [
    { "id": "problem", "title": "Dov asks", "beat": "problem", "set": "standing", "lines": [
      { "words": [7, 11], "line": "l2", "intent": "problem", "treatment": "insert", "scenes": ["ask"], "set": "standing",
        "action": { "verb": "think", "who": "dov" },
        "cast": [{ "id": "dov", "pose": "think", "expression": "happy", "at": "word:Did" }] } ] }
  ]
}
```

- `words` are inclusive indexes into `NARRATION.json`'s words; every word belongs
  to exactly one line, in order. `line` is the script line the map line
  plays. `scenes` names the shot that is up for those words.
- Every line with cast cues names its key `action` (`verb`, `who`), and a
  shot acts it.
- **Whoever speaks is on screen.** While a character says a line, a shot with
  that character in it is up. To stay on the listener instead, give the line a
  `why` ("we stay on Pia as it sinks in"). The narrator is never held to
  this.
- A silent script line is played by no map line: act it with a cue in the
  pause it leaves.

**The storyboard.** Add the scenes to the `storyboard.json` from step 4:

```json
{ "id": "ask", "module": "cast-scene", "start": "word:Did-0.25", "end": "word:Oh.-1",
  "params": { "set": "standing", "shot": "medium", "cast": [
    { "id": "pia", "pose": "stand", "expression": "neutral", "says": "auto",
      "cues": [{ "at": "word:It", "pose": "shrug", "expression": "happy" }] },
    { "id": "dov", "pose": "stand", "expression": "neutral", "says": "auto",
      "cues": [{ "at": "word:Did", "pose": "think", "expression": "happy" }] } ] } }
```

- One `cast-scene` per shot, on track 0, back to back: a scene ends where the
  next starts, and both are anchored to words (`word:<text>`,
  `word:<text>#2` for a second occurrence, `±seconds`).
- `"says": "auto"` on a character moves its mouth on its own lines. Give it
  to every character who speaks in the shot.
- Cut on a speaker change or a story beat, not on every line: three to six
  shots for 30 seconds. A two-shot (both characters, `standing`) carries an
  exchange; a single carries a reaction.
- Frame with `shot`: `medium` or `close` so faces read on a phone. A
  character at a desk or seated needs `medium` or `close`; `wide` there
  can leave the frame.
- Give every shot something to watch: a pose or expression change on the key
  word of each line, taken from the script's `playing` notes. Two people
  standing still while they talk fails the motion and density gates.
- Use only the bible's characters, sets and world. Do not edit the story's
  `cast` or `bible`.
- A closing `character-cameo` with a card carries a moral or a call to
  action.

Check, then read the shot list:

```bash
launchclip bible freeze <project>            # pins a newly written DIRECTION.json
launchclip story validate <project>/storyboard.json
launchclip layout-check <project>
launchclip story shots <project>
```

`story validate` checks the storyboard, the map and the script line ids.
In `story shots`, look for a speaker marked off screen without a reason, a
shot with nothing said, and script lines listed as unplaced.

## 6. Animatic and staging review (you are the critic)

The animatic is the whole story drawn at draft quality with the real voices
and captions. It locks the timing, and it is the cheap place to fix story,
staging and acting.

```bash
launchclip finish <project> --animatic --music synth
```

It writes `renders/animatic.mp4`, `ANIMATIC.json` (`launchclip.animatic.v1`: the
shots, the gates and the hashes of the storyboard and the bible) and contact
sheets in `qa/critic-sheets/`. Add the renderer flag the quick path's draft
step uses.

1. **Gates first.** `gates_failed` in `ANIMATIC.json` must be empty. A failing
   gate names its fix (`cast`, `bible`, `direction`, `acting`,
   `lip-sync`, `layout`, `motion`, `density`…). Repair the storyboard,
   never the gate.
2. **Review from the frames**, in a fresh context where you can: the contact
   sheets beside each character's reference sheet, with the shot list as
   text. Judge story, staging and acting only, in these categories:
   `narrative`, `composition`, `timing`, `acting`, `character-consistency`, `lip-sync`. Does the story land without
   sound? Is the speaker on screen and readable? Does each key action happen
   on its word? Does every character match its sheet in every shot? Does the
   mouth that moves belong to the speaker?
3. Save the review as `qa/animatic-critic.json` in the `qa/critic.json` format
   ([cinematic-production.md](cinematic-production.md)): a verdict of
   `ship`, `repair` or `replan`, and findings that cite the evidence ids
   they are about. A sheet is what a character must look like, never
   evidence. Then record the verdict in `ANIMATIC.json`:
   `"review": { "verdict": "ship", "file": "qa/animatic-critic.json" }`.
4. **Retake only what fails** (below), until the review says `ship` or
   3 passes are spent.

**Stop 2: the animatic.** Show the user `renders/animatic.mp4` with your
review and any retakes, and wait for a yes before the delivery steps. After
this the timing is locked: later changes restage a shot, they do not re-cut
it.

## 7. Draft, critic and retakes

Go back to the quick path at its **Draft** step and follow it to the end: the
draft render (`launchclip finish <project>`, which adds music, sound and the
master), a fresh-context critic that writes `qa/critic.json`, and the gate:

```bash
launchclip cinematic-check <project> --video renders/draft.mp4 --critique qa/critic.json --expect-audio
```

The loglines you judged are this story's concepts and the script is its
story: record them where the gate expects them, in the formats
[cinematic-production.md](cinematic-production.md) gives. The critic of a
character story also puts each reference sheet beside the frames and uses the
`acting`, `character-consistency` and `lip-sync` categories.

**Retakes.** A failed review, of the animatic or of the draft, is fixed one
shot at a time, by the cheapest step that could work:

1. `redirect`: change the shot a finding names (its poses, expressions,
   cues, set, framing or who is in it) in `storyboard.json`. Keep its
   `start` and `end`, and touch no other scene.
2. `replan-beat`: if that shot still fails, or the finding is about the
   story, restage every shot of its story beat the same way.

Render only what changed, then review again:

```bash
launchclip finish <project> --animatic --scene <shot id>     # drop --animatic for the draft
```

Record every pass in `qa/retakes.json`:

```json
{
  "schema": "launchclip.retakes.v1", "review": "animatic", "limit": 3,
  "status": "ship", "verdict": "ship",
  "rounds": [{
    "round": 1, "step": "redirect",
    "findings": [{ "id": "f1", "severity": "major", "category": "acting", "message": "Pia gives in with no change of pose.", "shots": ["ask"] }],
    "shots": ["ask"], "tried": "Pia puts her hands on her hips as she gives in.",
    "changed": ["ask"], "rendered": ["ask"],
    "verdict_before": "repair", "verdict_after": "ship", "kept": true
  }]
}
```

`review` is `animatic` or `final`; `status` is `ship` or
`needs-repair`. A pass that does not lower the blocking and major findings
is undone (put the scenes back as they were) and recorded with `"kept":
false`. After 3 passes that still do not ship, report `needs-repair`
and say which shots fail; do not present the video as finished.

## What the user gets

The draft, the two reviews, the retake record, and the contract files above.
Say which stops they approved, which gates passed, and anything still failing.
Render `--quality high` only after they approve the draft.
