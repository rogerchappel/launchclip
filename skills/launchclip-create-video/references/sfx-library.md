# SFX library and seeding workflow

LaunchClip resolves every sound effect through a locked **SFX library**, so a
project sounds the same in every video until you decide to change it.

## For open-source users: the short version

1. Add your key (optional): put `ELEVENLABS_API_KEY` in the process
   environment. Without a key everything still works with the original
   procedural kit.
2. Run `launchclip sfx seed`. With a key this makes about 24 ElevenLabs sound
   generations from the checked-in prompt set; without one it seeds from the
   procedural kit at no cost.
3. Listen: `launchclip sfx audition keystroke` (or any family) writes a contact
   WAV of every variant. `launchclip sfx list` shows what each family uses.
4. Reroll what you don't like: `launchclip sfx seed --reroll typing` (or
   `launchclip sfx reroll whoosh`) replaces just that family.
5. Done. `launchclip finish` uses the library from now on.

## Families

| Family | Use | Kept length |
| --- | --- | --- |
| `whoosh` | spatial travel, push, whip pan, transitions | ≤ 1.2 s |
| `impact` | big reveal, headline lock, scene slam | ≤ 1.6 s |
| `riser` | tension into a payoff; ends on its loudest point | ≤ 2.6 s |
| `tick` | counter step, data point lands | ≤ 150 ms |
| `pop` | object or label appears | ≤ 300 ms |
| `shimmer` | insight, resolve | ≤ 2.2 s |
| `subdrop` | final payoff weight | ≤ 2.2 s |
| `click` | UI click, toggle; soft word ticks | ≤ 100 ms |
| `keystroke` | one mechanical key press (typing track) | ≤ 120 ms |
| `keystroke-space` | space bar: heavier, with stabiliser rattle | ≤ 180 ms |
| `keystroke-enter` | enter/return: firmer | ≤ 170 ms |

Aliases for `--only` and `--reroll`: `typing` (the three keystroke families)
and `ui` (click, tick, pop). Cue names in a storyboard keep their modifiers:
`whoosh-soft` plays a whoosh at 60% level.

## Where finish looks

1. an explicit library: `finish --sfx-library <dir>`, or a style pack's
   `sound.sfx_library`
2. the project library: `<project>/.launchclip/sfx/library.json`
3. the user library: `~/.launchclip/sfx/library.json` (or
   `$LAUNCHCLIP_SFX_HOME`), shared by all your projects
4. the procedural kit (`scripts/synth-audio-kit.mjs`), always available

A family missing from one source falls through to the next. Each event picks
a variant from a hash of the story and the event, so repeats vary and a
re-render is identical. `--sfx-density low|normal|high` (or a style pack's
`sound.sfx_density`) thins optional cues deterministically; hits always stay.

## Seeding details

- **Prompts.** `src/sfx/prompts.json` holds one carefully written prompt per
  family with its duration, prompt influence and variant count (for example
  "single mechanical keyboard key press, cherry blue switch, close mic, dry,
  one keystroke only"). Requests go to `POST /v1/sound-generation`.
- **Cost boundary.** Seeding is a one-time, opt-in spend. Every download is
  cached under `<dir>/cache/` by the hash of its request and never requested
  again; `--force` re-processes from the cache for free. Only `--reroll`
  makes new generations, and only for the families named.
- **Processing.** Each clip is converted to 48 kHz WAV, DC-corrected, trimmed
  so its transient starts within 5 ms (onset detection), tail-trimmed with a
  fade, capped to its family length and peak-normalised. Silent, clipped and
  messy multi-hit clips are rejected; for single-hit families the cleanest hit
  is kept. Measurements (onset, duration, peak, loudness) are recorded in
  `library.json`.
- **Key safety.** The key is read from the environment only and is never
  printed, logged, written or included in an error. Never paste it into a
  brief or a manifest.
- **Licensing.** The procedural kit is original synthesis with no samples.
  ElevenLabs output is governed by the ElevenLabs terms of service; finish
  records which source each cue used in `qa/sfx.json` and the licence line in
  `AUDIO-MANIFEST.json`.

## Typing track

Typed code (`code-snippet` with `typing: true`) gets one keystroke on each
character's visible time, the space-bar key on spaces and the enter key between
lines, with small seeded level and pitch variation and a 25 keys per second
cap. Kinetic text that reveals word by word gets a soft click per word.
