#### Narration: `audio.narration`, `launchclip voice`, then word anchors

For a synthesised voice, write the script into `storyboard.json` and let
`finish` produce the voice and its word timings. Do not hand-write
`audio.voice` or `audio.words` for a synthesised take:

```json
"audio": {
  "narration": {
    "text": "Your launch stalled at the last step. Here is why.",
    "provider": "kokoro",
    "voice": "af_heart",
    "speed": 1.2
  }
}
```

| field | required | default | notes |
| --- | --- | --- | --- |
| `text` | yes | | The whole script, at most 4000 characters. Sentences end in `.`, `!` or `?`. |
| `provider` | no | `kokoro` | `kokoro` (local, free), `elevenlabs` (paid, needs `ELEVENLABS_API_KEY` and the user's approval), `supplied` (audio you already have in `audio.voice`), `test` (offline placeholder tone). |
| `voice` | no | `af_heart` for Kokoro | The provider's voice id. |
| `speed` | no | `1.2` for Kokoro, else `1` | 0.5 to 2. Speed is a generation parameter, not a time-stretch, so change it to fit a target length. |

`finish` synthesises the take into `assets/audio/narration.wav` and
`NARRATION.json` (`launchclip.narration.v1`: the text, provider, voice, speed,
`duration_seconds` and every word's `start`/`end`), then uses it for word
anchors, captions, ducking and beat sync. `finish --voice <provider>`
overrides `provider` for one run. Takes are cached in `.launchclip/voice` by
text, provider, voice and speed, so an unchanged script is never synthesised
twice.

Work in this order:

1. **Write the narration text first**, in `audio.narration`, before any
   scenes (`"scenes": []` is fine at this point).
2. **Measure it:** `launchclip voice <project>` (or
   `launchclip voice --text "..." --voice kokoro --speed 1.2` without a
   project). It synthesises the take (cached), writes `NARRATION.json`, and
   prints the duration, word count, words per minute and one row per sentence
   with its start, end and first-word anchor (for a dialogue story,
   `audio.narration.lines`, one row per line with its speaker; each line is
   voiced in its speaker's voice and `finish` reuses those takes). Adjust the
   text or `speed` and
   rerun until the duration fits the target; never guess the length from a
   word count.
3. **Size the scenes to the real take:** set `format.duration` to the
   measured duration plus a short tail (about 0.3 to 0.8 s), and give each
   beat the span of its sentences.
4. **Anchor scenes and hits to words, not seconds:** `"start": "word:stalled"`,
   `"at": "word:twelve"` (`word:<text>#2` for the second occurrence). Anchors
   survive a re-take; seconds do not.
5. **Run `finish`.** It reuses the measured take and fails validation if an
   anchor names a word that is not in the narration.

If you change the text, rerun `launchclip voice` before moving scenes, then
check that every anchor still resolves with `launchclip story validate`.
