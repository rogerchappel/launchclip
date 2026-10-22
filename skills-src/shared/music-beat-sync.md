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
  their account. The request comes from the story: tone, target BPM, the
  scene-energy arc (as a composition plan with one section per energy segment)
  and no vocals. The length is whole bars at the target BPM plus a tail, and
  every section boundary snaps to a bar line, so nudging a cut by less than
  half a bar maps to the same request. Every generation is cached by request
  under `$LAUNCHCLIP_CACHE/elevenlabs/music`.
- **The music lock.** After the first generation, `finish` writes
  `.launchclip/music-lock.json` (request hash, the track copied to
  `.launchclip/music/`, BPM, and the *music brief* that produced it) and
  reuses that track while the brief is unchanged. The brief is the provider,
  model, `audio.music.prompt`, target BPM, style-pack music hints, seed,
  narrated or not, and a length bucket (the track must cover the story plus
  1 s and run at most 8 bars past it). Scene timing, words and module edits
  are not part of it: they only re-run beat sync and alignment against the
  locked track. So **iterate freely on everything except the music brief**;
  changing the brief (or scene energies you want the music to follow: pass
  `--music-regenerate` then) is a new paid generation.
- **Read the music line `finish` prints.** `music: REUSE locked ...` or
  `music: REUSE cached ...` costs nothing; `music: PAID ElevenLabs generation
  of N s (about $X) (reason)` spends credits and says why (no lock yet, which
  brief field changed, the story outgrew the track, or
  `--music-regenerate`). If you did not expect `PAID`, stop before the next
  run and find out why. Output terms depend on the user's ElevenLabs plan
  (see `THIRD_PARTY_NOTICES.md`).
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
