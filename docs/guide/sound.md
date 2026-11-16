# Voice, music and sound effects

LaunchClip scores every video for you: a voiceover, a music bed, sound effects on every visual beat, typing sounds when code appears, and a final mix mastered for social platforms. It all works with **no API keys**, and you can upgrade any part.

| | Free (built in, runs on your machine) | Optional upgrade |
|---|---|---|
| Voice | Kokoro, an offline open-source voice | ElevenLabs voices (`ELEVENLABS_API_KEY`) |
| Music | A procedural bed shaped to the video's energy, in nine genres from ambient to house to chiptune | ElevenLabs music, composed to the video and synced to the beat |
| Sound effects | A built-in kit of 31 effect families (whooshes, impacts, chimes, page turns, shutters, cash registers and more, plus mechanical keyboard typing) in 12 sonic palettes | Your own ElevenLabs-generated library |
| Ambience | Quiet, looping room sound for the scene's world: an office, a cafe, a street by day or night, rain, waves | — |
| Your own audio | Supply a voiceover or a music file and it's used as is | — |

The first time the built-in voice runs, it downloads its model (about 325 MB) once.

## Your own voiceover

Drop in a recorded voiceover and LaunchClip uses your timing and words: it tightens long pauses, levels the loudness and lines up captions to what you said.

## Talking-head recordings

When the video is built on a recording of someone speaking (the footage-led lane), the speaker's own audio is the voice. The music bed and any ambience duck under it exactly as they would under a voiceover: the recording's audio keys the sidechain, lined up with the stretches of the recording the video plays, and `AUDIO-MANIFEST.json` records `mix.ducking: "sidechain under footage speech"`. A muted recording (`base.volume: 0`) keys nothing.

## Music that follows the edit

With an ElevenLabs key, LaunchClip composes an instrumental track sized to your video, with calm sections where the video is calm and lift where it builds. It then lines the beat up with the cuts:
- **Videos with narration:** the music shifts so downbeats land on the big moments.
- **Videos without narration:** the cuts snap to the beat.

Once a project has a track, it is **locked**. Change scenes as much as you like and LaunchClip reuses the same track (it prints `REUSE` or `PAID` before any request), unless you ask for a new one with `--music-regenerate`.

## How loud the music sits

The bed's level follows the video's energy (about 0.24–0.44 of full gain), or `audio.music.volume` in the story when set. `--music-volume <0-1>` on `launchclip make` or `launchclip finish` overrides both, for every music source (synth, ElevenLabs or your own file); for example `--music-volume 0.15` keeps it well under the voice. The level is recorded in `AUDIO-MANIFEST.json` as `music.volume`.

## A sound for every style

A style can carry a `sound` block. A seeded style (see the seeded styles RFC) gets one drawn from its seed, so two videos made from bare prompts don't sound alike, and the same project always sounds the same.

```json
"sound": {
  "palette": "organic",
  "music": { "genre": "lo-fi", "bpm": 84, "key": "D", "progression": 2 },
  "ambience": "auto",
  "sfx_density": 0.5
}
```

- **`palette`** sets the timbre of every sound effect. A whoosh in `organic` is breath and paper; in `retro-8bit` it is a bit-crushed square-wave zap. The palettes are `cinematic`, `glassy`, `organic`, `cartoon`, `lofi`, `retro-8bit`, `analog`, `minimal`, `documentary`, `synthwave`, `soft` and `industrial`. The style's seed draws fresh variants inside the palette, so your whooshes are your own.
- **`music`** picks a synth genre: `ambient`, `lo-fi`, `house`, `synthwave`, `acoustic-pluck`, `cinematic-pulse`, `chiptune`, `jazz-hop` or `orchestral-lite`. Each has four chord progressions, its own instruments and tempo range, and drums that come in where the video builds. The beat still lines up with the cuts.
- **`ambience`** plays a quiet room sound under everything, ducked when someone speaks. `auto` picks one from the style's world (a cafe murmurs, a night street has distant traffic and a siren, a park at night has crickets); you can also name a bed (`office`, `cafe`, `street-day`, `street-night`, `crickets`, `rain`, `waves`, `wind`, `server-room`, `crowd`, `birds`, `room-tone`, `space-hum`) or say `none`.
- **`sfx_density`** sets how many effects play, from `0` (only some of the hits) to `1` (all of them). `low`, `normal` and `high` still work. Effects are paced whatever the density: at most 2 (low), 3 (normal) or 5 (high) in any 10 seconds, never the same kind twice running, and a whoosh at most every 4 seconds. Without a density, a footage-led video (or one that is mostly full-frame clips) gets `low`.

A storyboard can override any of it with `audio.sound`. With no `sound` block, nothing changes: you get the same built-in sound as before.

To hear everything, run:

```bash
node scripts/sound-audition.mjs --out audition
```

It writes one WAV per palette (every effect in turn), a 20-second clip per genre, every ambience loop, and a mastered test mix per genre, and checks them all against the loudness and audio gates.

## A score instead of a bed

A style or story can ask for a sound score: `"sound": {"score": true}` (the `signal-ui` style does). The whole soundtrack is then planned from what the video does and says, with no music underneath unless the story or `--music` asks for a track:

- **Moments carry the emotion.** A scene hit with a `moment` says what the viewer should feel: `{"at": "word:cheap", "event": "cheap", "moment": "letdown"}`. The moments are `letdown`, `promise`, `reveal`, `impact`, `crystallise`, `wonder`, `miss` and `resolve`. Unlocks, an exact-frame landing and the close get one on their own.
- **Big turns use the whole room.** A scene with energy 3 or `build` opens with a whoosh crossing the stereo field over a deep bass drum, and the room drops away just before it.
- **Interfaces sound like hardware.** A playhead or scan hunts like a typewriter carriage, with an arcade blip and a type bar on each find. A dial clicks through its detents and stops dead, a fader slides and seats, and a frame ruler steps and slows.
- **Paper sounds like paper.** A map fold creases open panel by panel, a limb slides out from behind, and side panels snap up.
- **Rewards climb.** Each unlock plays a rising arpeggio higher than the last, and the finds in a scan climb note by note.
- **Everything else that changes on screen** gets a small sound, panned to where it happens. `sfx_density` thins these out.

Everything pitched stays in one key (`sound.music.key`, default A major), and bass notes are only its tonic or fifth. The bass drums, blips and plucks are made by LaunchClip itself. With [Earshot](https://github.com/Leonxlnx/earshot) installed, the rest come from its sound bank, retuned to the key; without it, they come from your library or the built-in kit, which is thinner, and `finish` says so. `qa/sfx.json` lists every cue with the reason it is there.

## Your own sound-effect library

The built-in effects are good. If you want effects that are unique to you, seed a library once (a library wins over the palette for the families it has):

```bash
launchclip sfx seed               # uses ElevenLabs if a key is set, otherwise the built-in kit
launchclip sfx audition whoosh    # listen to every whoosh variant
launchclip sfx reroll keystroke   # don't like the typing sounds? regenerate just those
```

Running [ComfyUI](comfyui.md) locally? `launchclip sfx seed --provider comfy` makes the library on your own machine instead.

Every clip is trimmed so it starts exactly on its hit, its tail is faded, and it is levelled. From then on, every video uses your library, so your channel sounds consistent. It lives in `.launchclip/sfx/`, or in `~/.launchclip/sfx/` to use it across projects.

## Visuals that move with the sound

Add `audio.react` to a story and parts of the picture follow the finished mix:

```json
"audio": { "react": { "glow": true, "bar": true, "pulse": { "strength": 0.3 } } }
```

- `glow` swells the light's key glow on the music's kicks.
- `bar` draws a thin level bar along the bottom edge that follows the mix loudness.
- `pulse` blooms a soft ring at the centre on the music's beats and hits.

Each takes `true` or `{bus, series, strength}`: `bus` is `mix`, `music` or `voice`; `series` is `loud`, `sub`, `low`, `mid`, `high`, `air` or `onset`; `strength` runs from 0 to 1. The sound stage measures the mix once into `AUDIO_FEATURES.json`, and both renderers read those numbers, so they draw the same frames. The camera never reacts.

To give every video of a brand the same reactive layers, put them in the style pack as `sound.react` (same shape). A video's own `audio.react` replaces the pack's whole, and `"react": {}` in a video turns them off:

```json
"sound": { "react": { "glow": { "bus": "music", "strength": 0.4 }, "pulse": true } }
```

For a scene that is the sound itself, use the `audio-visualizer` module: a spectrum of `bars` (the default), a mirrored `line` or a `ring`, bass to air, following the mix every frame.

```json
{ "id": "drop", "module": "audio-visualizer", "start": 12, "end": 16, "params": { "variant": "ring", "bus": "music" } }
```

`bus` picks the sound (`mix` by default), `tone` the colour and `bars` how many (8–128). It reads the same `AUDIO_FEATURES.json`; without it the bars rest flat.

## Charts you can hear

Add `"sonify": true` to the sound block (`audio.sound` in a story, or a style's `sound`) and every chart scene plays its data as a plucked string while it draws: `bar-chart`, `stacked-bar`, `pie-chart`, `area-chart`, `radar-chart`, `sparkline` and `progress-ring`.

```json
"audio": { "sound": { "sonify": true, "music": { "genre": "ambient", "key": "A" } } }
```

Higher values play higher notes, in the music's key. Each bar, segment or point plays on the frame it appears, panned to where it sits. Pie slices build a chord, radar plays an arpeggio, a progress ring climbs to its value, and a highlighted bar or slice plays again an octave up. It replaces the chart's tally blips. It is off unless you ask for it.

## Delivery-ready loudness

Every finished video is mastered to −14 LUFS with a −1 dBTP ceiling, the level YouTube, TikTok and Instagram expect. The voice stays clearly above the music.
