#### Music and beat sync in `launchclip finish`

`finish` picks the music: `--music synth|elevenlabs|none`, then
`audio.music`, then ElevenLabs when `ELEVENLABS_API_KEY` is set (the CLI reads
`.env` from the working directory, the project directory and each parent up to
the repo root, without overriding the shell), else the license-free synth bed.
If `finish` warns that ElevenLabs was asked for but the key is not set, it
used the synth bed: stop and fix the key rather than shipping that mix. `audio.music` takes `"synth"`,
`"none"`, an `assets/` path, or
`{provider: "elevenlabs" | "synth" | "file", prompt?, bpm?, file?, sync?: "auto" | "off" | "cuts" | "hits"}`.

- **ElevenLabs is paid.** Use it only when the user has approved spending on
  their account; `finish` prints a one-line notice with the cache path. The
  brief comes from the story: tone, target BPM, the scene-energy arc (as a
  composition plan with one section per energy segment) and no vocals. Every
  generation is cached by prompt or plan, length, model and seed under
  `$LAUNCHCLIP_CACHE/elevenlabs/music` and is never generated twice, so iterate
  freely on everything except the music brief. Output terms depend on the
  user's ElevenLabs plan (see `THIRD_PARTY_NOTICES.md`).
- **Set energy honestly** (calm intro, `"build"` before the payoff, 3 on the
  payoff): it drives both the bed and the ElevenLabs sections.
- **Beats.** The track's BPM, beats and downbeats are measured into
  `BEATS.json` (`launchclip.beats.v1`), so `beat:n` / `downbeat:n` anchors
  resolve against the real music. A hand-written `BEATS.json` is never
  overwritten.
- **Beat sync follows the lane.** Narrated: the music's start offset (and a
  tempo change of at most 3%) is chosen so downbeats land on the first cut
  after the hook, the payoff/CTA start and strong hits; story time never
  changes. Motion (no narration): second-timed cuts snap to the nearest
  downbeat and hits to the nearest beat within 0.25 s, each move re-checked
  against its module and layout-check, and reverted when it breaks one.
  Word anchors never move off their word.
- **Check `qa/beat-sync.json`:** requested vs measured BPM, the offset and
  tempo, every key moment's distance to its downbeat, and each change,
  fallback and skip. Plan cuts on bar lines (bar = 4 × 60 / BPM s) so fewer
  of them need to move.
