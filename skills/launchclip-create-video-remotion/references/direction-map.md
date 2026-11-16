# Direction map

<!-- Generated from kit/core/planning-prompt.mjs by scripts/sync-skills.mjs. Do not edit by hand; run `npm run skills:sync`. -->

Write `DIRECTION.json` (launchclip.direction-map.v1) beside `storyboard.json` before the storyboard: every line of the narration gets an intent and a visual decision. The storyboard says what renders, the map says why each scene exists, and the cadence profile (`references/profiles.md`) says what the whole should measure like. `launchclip story plan` and `launchclip make` ask the model for the same map first. Design: `docs/VIDEO_QUALITY_RFC.md` §6 in the LaunchClip repo.

## Steps

1. Read the narration words (`NARRATION.json`, or the edited transcript for footage) and split them into lines at sentence ends. Number the words from 0.
2. Pick the cadence profile for the story (`launchclip profile list`; `references/profiles.md`) and note its coverage target and undressed limit.
3. Classify each line with the intent rules below, then choose its treatment. Dress every line whose intent calls for a visual; hold a line on the presenter only on purpose, and say why.
4. Name the scene ids each dress or insert line will get, then author `storyboard.json` with those scenes on those words.
5. `launchclip story validate storyboard.json` checks the map: every word in a line, every named scene present and overlapping its words, and coverage, face time and the longest undressed run against the profile band.

## Contract

- schema: "launchclip.direction-map.v1" (exactly); profile: the cadence profile id (given).
- sections: [{id ("s1"…), title, layout?, lines: [...]}]: topics in order (story beats for a character story). A section holds one footage layout: "full", "split-left", "split-right", "framed", "stacked", "insert" (footage-led only; "full" is today's overlays-over-the-recording).
- lines: [{words: [first, last], intent, treatment, scenes?, why?}]. words are inclusive indexes into the narration words, so the map survives re-timing. Every word belongs to exactly one line, in order.
- intent: one of hook, claim, problem, turn, proof, number, list, process, product, personal, quote, cta (see the intent rules).
- treatment: dress (a visual alongside the presenter), insert (a full-frame visual over the voice), face (hold on the presenter on purpose), camera (a punch-in or camera move only).
- dress and insert lines name the scene ids that will show them ("scenes": ["s3"]); face and camera lines give a short why ("the turn lands on his face").
- Dress every line whose intent calls for a visual (hook, claim, problem, proof, number, list, process, product, quote, cta) unless it works better on the presenter, and then say why. A character story's lines may add cast cues ({id, pose, expression, at: "word:<text>"}) and a set.
- A character story's line with cast cues names its key action, and every beat (section) has at least one: action {verb: look-far | turn-to-look | gaze-at | point-at | walk-to | stand-up | stretch | a pose, who, target?}. It is what a character does on screen to show the line (looking far away, standing up, pointing at the proof). The acting gate fails when no cast scene performs it on that line.
- A character story keeps a speaking character on screen: while a character (not the narrator) speaks a line, a scene that draws that character is up for those words. To hold the picture elsewhere (the listener's reaction, a prop), give the line a why ("we stay on Maya as it sinks in"). A line may also carry line: the id of the script line it plays (SCRIPT.json, "l3") when the story has a script; the word range stays the source of timing.

## Intent rules (first match wins)

| Intent | The line… |
| --- | --- |
| cta | asks the viewer to act: try, sign up, download, follow, the link |
| quote | quotes someone: quotation marks, "said", "told me" |
| number | gives a figure: digits, a percentage, "twelve minutes", "doubled" |
| list | lists things: "three things", "first… second", items separated by commas |
| process | explains how something works or a sequence of steps |
| product | names or shows the product, a feature or the app |
| turn | turns the story: "but", "so", "instead", "that's when", "turns out" |
| problem | names a problem or a pain |
| proof | backs a claim with evidence: customers, results, reviews, data |
| personal | the speaker about themselves: a personal story or feeling |
| hook | is the first line (unless it is a call to action) |
| claim | matches none of the above |

## Treatment

`treatment` sits beside `sections`: the film's idea and its rules, written before the storyboard (design: `docs/PLAN_AND_PACE_RFC.md` §1). `story validate` and the direction gate check every field against the storyboard. Optional on the structured and guided tiers; required on bespoke.

- treatment (optional): one object beside sections that holds the film's idea and its rules. Each field is checked against the storyboard.
- concept: the whole film as one sentence of at most 20 words. It names something that changes ("one cursor blink grows into every tool the agent can reach"), never a subject ("AI agents") and never the title.
- throughline: {object, states: [{at, form, carry?}]}. Pick one object that stays on screen from the first section to the last and takes a new form in each. at is a section id, form is what the object looks like there, carry is the transition that hands it across (card-to-card, morph).
- banned: short tokens for what this film must never do. Start from the style's list (crossfade, bounce-ease, lens-flare) and add whatever the brief rules out. Use these tokens where one fits, since each is checked: crossfade (no fade between two full-frame scenes); bounce-ease (no elastic ease and no back ease overshooting past 1.7); camera-shake (no camera kicks and no shake); brand-before-end (no logo or wordmark scene before the last 15% of the runtime); particles (no particle scene or particle effect); lens-flare (no light-leak transition and no flare effect); hold>N (nothing on screen freezes for more than N seconds (the pace gate's max_still)). Any other phrase goes to the critic.
- locked_copy: {only?, lines: [...]}: the brief's exact words, in the order the brief gives them. Never reword, re-case or re-punctuate a locked line; a scene that shows it shows it exactly. With only: true, show no other slogan or headline.
- guardrails: [{claim, forbid: [...]}]: each claim the film must not overstate, with the words that would overstate it ({"claim": "release status", "forbid": ["stable", "v1.0"]}). No scene text and no narration may use them.
- locked_example: {label, values: {name: number}}: when the film works one example, fix its numbers here once. Every scene that shows one of them shows this value.
- transitions: [{from, to, type, demonstrates}]: one entry for every scene change that is not a cut. demonstrates says in a few words what the change itself proves ("the stream stops mid-word and picks up where it stopped"); a change that proves nothing is a cut. At most one fade per 30 s.
- signature: {at, describe}: the one shot a viewer will remember, in a section between a quarter and 85% of the way through. Describe what the viewer sees happen, with no effect names (no glow, blur, particles or transition names).

## Narrative maps

A story told by characters uses story beats as sections (`beat`: setup, problem, attempt, turn, resolution, cta), and each line says who acts: `cast: [{id, pose, expression, at: "word:<text>"}]` and a `set`. Cast cues name characters from the story's cast and poses, expressions and sets from the character kit; validation checks them when the kit is present.
Each line with cast cues names its key action, `action: {verb, who, target?}` (an acting cue such as look-far, turn-to-look, gaze-at, point-at, walk-to, stand-up, stretch, or a pose), and each beat names at least one. If the idea is an action, someone does it on screen, toward what it is about. `launchclip finish` fails the acting gate when no cast scene performs it on its line.
With a script (`SCRIPT.json`, speakers and silent lines), give each line `line`: the id of the script line it plays, e.g. `"line": "l3"`. Validation checks the id names a spoken line of the script and that the words in its range are voiced by that line's speaker. A script line may be played by more than one map line; a silent line (`speaker: null`) is played by no map line, so act it with a cue in the pause it leaves.
While a character speaks, a scene that draws that character is on screen: every spoken word (its midpoint) falls inside a `cast-scene`, `character-cameo` or `sprite-scene` with the speaker in it. A line whose picture stays elsewhere says so in `why` (`"why": "we stay on Maya's reaction"`); without one, `story validate` and the direction gate fail it. The narrator is never held to this.
`launchclip story shots <project> [--json]` prints the shot list from the two files: each character scene with its time and frames, who is in it, the set and framing, the key actions, every pose change, and the lines said while it is up (script line id, speaker, on screen or off). Read it before rendering: a shot with nothing said, a speaker off screen, or a script line no map line plays shows there.

## Long form

- Long form (5 min and up, or the youtube-long-form profile): each section is a chapter. Give every section a short `title` (2–5 words, the chapter name viewers see in the YouTube chapter list) and make each one at least 10 s; aim for 3–10 chapters, a new one every 1–3 minutes.
- The first section opens with the hook line and the promise: say what the video will cover. The structure pass adds an "In this video" icon-row of the chapters after the hook line, a section-card insert at each later chapter start, and a progress line with chapter ticks in the brand frame (`launchclip story long-form`; the headless planner runs it).
- Leave the first 2–3 s of each chapter free of other scenes so its section card has room; a planned scene in the way starts later or the card shortens.
- Attention resets: plan a layout change (a section with another layout), an insert line or a section card about every minute (the profile's longest_without_reset_seconds p50), never more than its p90 apart. Where a run is longer, the structure pass turns an overlay card near the right time into an insert, else switches the layout for up to 20 s.
- `launchclip story long-form <project>` then writes `chapters` into storyboard.json (and section titles into the map); `launchclip finish` writes `renders/chapters.txt` for the YouTube description and puts the chapters in the MP4 and the NLE exports.

## Required

- `story validate` requires `DIRECTION.json` in the footage-led, motion and voiceover-motion lanes when the story has narration words (`audio.words`); without words a missing map is a warning.
- `launchclip finish` gates coverage, direction and face against the profile.

## Example

```json
{
  "schema": "launchclip.direction-map.v1",
  "profile": "youtube-talking-head-launch",
  "sections": [
    {
      "id": "s1",
      "title": "The problem",
      "layout": "split-right",
      "lines": [
        {
          "words": [
            0,
            23
          ],
          "intent": "claim",
          "treatment": "dress",
          "scenes": [
            "die"
          ],
          "why": "three parallel claims; one visual per claim"
        },
        {
          "words": [
            24,
            43
          ],
          "intent": "problem",
          "treatment": "dress",
          "scenes": [
            "build-properly"
          ]
        },
        {
          "words": [
            44,
            52
          ],
          "intent": "personal",
          "treatment": "face",
          "why": "the turn lands on his face"
        }
      ]
    }
  ]
}
```
