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

Missing families: `launchclip sfx list` names the families of the prompt set
that no library has (`missing`); they fall back to the procedural kit, and
`finish` says so in one `sfx:` warning line. `launchclip sfx seed --missing`
fills only those families (paid only with a key and an uncached request; add
`--provider synth` to stay free) and leaves every other family locked.

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

The procedural kit has 20 more families. They are not in the ElevenLabs
prompt set, so they always come from the kit:

| Family | Use |
| --- | --- |
| `swipe` | a quick card or screen swipe |
| `slide` | an object slides into place |
| `snap` | a snap into place, a quick lock |
| `thud` | something heavy lands softly |
| `chime` | a little arpeggio: idea, unlock, welcome |
| `ding` | one bell note: done, correct, attention |
| `ping` | a short bright ping: highlight, location |
| `glitch` | a digital stutter: error, hack, corruption |
| `tape-stop` | everything grinds to a halt |
| `page-turn` | paper turns: a new chapter, a document |
| `pen-scribble` | writing or signing |
| `camera-shutter` | a photo or a screenshot |
| `cash` | money in: a sale, revenue, a price |
| `notification` | a message arrives |
| `error-buzz` | wrong, denied, failed |
| `success` | it worked: a win, a check mark |
| `boing` | a springy bounce |
| `sparkle` | magic, polish, something shiny |
| `footstep` | someone walks in |
| `door` | a door closes: an exit or an ending |

Name any of them as a hit's `cue` (`"cue": "page-turn"`, `"cash-soft"`).

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

## Sonic palettes

A style's `sound.palette` (or a storyboard's `audio.sound.palette`) draws
the procedural kit in one of 12 palettes: `cinematic`, `glassy`, `organic`,
`cartoon`, `lofi`, `retro-8bit`, `analog`, `minimal`, `documentary`,
`synthwave`, `soft`, `industrial`. A palette sets the timbre of every family
(pitch range, envelopes, waveform, the material a struck sound rings like,
drive, bit-crush, tape wobble, chorus and a convolution room), and the
style's seed draws each family's variants inside it, so `(family, palette,
seed)` always gives the same sound and a new seed gives fresh ones. With a
palette, hit events whose names say what they are also reach the new
families (`sale` → `cash`, `error` → `error-buzz`, `task-done` →
`success`); without one the cue table is the historic one. Libraries still
win over the kit for the families they have. Option lists:
`kit/core/sound/options.mjs` (`SOUND_PALETTES`, `SFX_FAMILY_NAMES`,
`AMBIENCE_BEDS`, `MUSIC_GENRES`).

```bash
node scripts/synth-audio-kit.mjs out --palette organic --seed 7f3a91c2
node scripts/synth-audio-kit.mjs out --bed 30 --genre lo-fi --key D --progression 2 --kick-from 6 --kick-to 24
node scripts/synth-audio-kit.mjs out --ambience street-night --seed 7f3a91c2
```

A family missing from one source falls through to the next. Each event picks
a variant from a hash of the story and the event, so repeats vary and a
re-render is identical. `--sfx-density low|normal|high` or a number from 0
to 1 (or a style pack's `sound.sfx_density`) thins cues deterministically:
`normal` (0.6) and above keep every cue, `low` (0.25) keeps the hits and
about half of the optional cues, values between scale linearly, and below
0.25 the hits thin too (about a third remain at 0).

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
