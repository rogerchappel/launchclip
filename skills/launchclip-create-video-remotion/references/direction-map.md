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

## Narrative maps

A story told by characters uses story beats as sections (`beat`: setup, problem, attempt, turn, resolution, cta), and each line says who acts: `cast: [{id, pose, expression, at: "word:<text>"}]` and a `set`. Cast cues name characters from the story's cast and poses, expressions and sets from the character kit; validation checks them when the kit is present.

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
