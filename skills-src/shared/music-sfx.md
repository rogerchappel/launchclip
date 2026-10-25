## Resolve music and sound effects deliberately

Treat music and SFX as separate choices. Record the decision, provider, local
source, expected cost boundary, and permission in `BRIEF.md` before resolving
audio.

- **Music:** support none, a supplied track, or user-approved ElevenLabs music.
  ElevenLabs consumes credits, so require explicit opt-in before the request.
  Check only whether `ELEVENLABS_API_KEY` is present in the process environment
  or an approved workspace `.env`; never print the value. A file existing does
  not load it automatically, so export just that variable for the generation
  subprocess. Generate one instrumental bed sized to the edit, leaving
  midrange space for narration and requesting a clean ending. Do not use an
  OpenAI key for subscription-mode orchestration or music.
- **Sound effects:** support none, authorized local files, the locked SFX
  library, or the original procedural kit from `scripts/synth-audio-kit.mjs`
  (local FFmpeg, no samples, no cost; 31 families with several seeded variants
  each, UI clicks and mechanical keystrokes). When the style pack has a
  `sound` block, pass its palette and the style's seed (`--palette <id>
  --seed <seed>`), its genre for the bed (`--genre <id> --key <k>
  --progression <n>`) and its ambience bed (`--ambience <bed>`; for `auto`
  use the style's world), so the video sounds like its style; the option
  lists and the world → ambience map are in `scripts/sound/options.mjs`. With the LaunchClip CLI, `launchclip
  finish` resolves cues through the library seeded once with `launchclip sfx
  seed` (ElevenLabs with the user's explicit approval, or the procedural kit),
  then the kit; see
  [references/sfx-library.md](references/sfx-library.md). Inspect supplied
  resources, project/style-pack audio, and the active LaunchClip checkout or
  installed package's `public/sfx` if it exists; do not assume every distribution
  includes a library. Recursively inventory `.wav`, `.mp3`, `.m4a`, `.aac`,
  `.ogg`, and `.flac` files, then copy only selected cues into the project. Match cues by semantic filename and
  audition them locally. Do not assume a private machine path in the reusable
  skill. Do not call ElevenLabs Sound Effects merely because the music provider
  was approved; that requires a separate explicit request.
- Bind each SFX to a visible event such as a cut, lock, strike, impact, or
  object handoff. Use a small cue vocabulary and avoid decorating every beat.
- When the track has a stable pulse, derive a beat map locally and save it as
  `BEATS.json`. Move selected scene boundaries or internal accents to nearby
  beats when speech timing permits; narration remains authoritative. Avoid
  continuous beat pulsing that competes with the presenter.
- Start a music bed around 10-18% under supplied speech and SFX around 20-35%,
  then audition the mix. Fade or duck the bed around dense speech and the final
  spoken line. Keep every resolved file local and deterministic.
